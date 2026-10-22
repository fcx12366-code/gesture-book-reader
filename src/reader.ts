// page-flip 2.0.7 publishes JavaScript and source, but no declaration entry.
// @ts-ignore
import { PageFlip } from 'page-flip';
import { PdfEngine, isCancelled } from './pdf-engine';
import type { PageBitmap } from './pdf-engine';
import './reader.css';

export type ReaderLayout = 'auto' | 'single' | 'double';
export type ReaderCallbacks = {
  onPage(page: number, total: number): void;
  onProgress(text: string): void;
  onError(message: string): void;
  onLoaded?(fingerprint: string, total: number): void;
  onPassword?(retry: boolean): Promise<string | null>;
};
type FlipBook = {
  on(event: string, callback: (event: { data: number | string }) => void): void;
  off(event: string): void;
  loadFromHTML(pages: HTMLElement[]): void;
  getSettings(): Record<string, number | boolean | string>;
  getCurrentPageIndex(): number;
  getState(): string;
  getUI(): { onResize?: EventListener };
  getRender(): { finishAnimation(): void };
  update(): void;
  turnToPage(index: number): void;
  flipNext(): void;
  flipPrev(): void;
  destroy(): void;
};

/** Browser-only PDF book. All public page numbers are 1-based. */
export class PdfReader {
  private engine: PdfEngine | null = null;
  private flip: FlipBook | null = null;
  private viewport = document.createElement('div');
  private transform = document.createElement('div');
  private book = document.createElement('div');
  private pages: HTMLElement[] = [];
  private layout: ReaderLayout = 'auto';
  private single = false;
  private zoom = 1;
  private pageWidth = 480;
  private pageHeight = 680;
  private ratio = 480 / 680;
  private selected = 1;
  private generation = 0;
  private renderGeneration = 0;
  private destroyed = false;
  private pan = { x: 0, y: 0 };
  private drag: { id: number; x: number; y: number; left: number; top: number } | null = null;
  private resizeObserver: ResizeObserver;
  private resizeTimer: ReturnType<typeof setTimeout> | undefined;
  private animationFrames = new Set<number>();
  private framesAlive = true;
  private abortEvents = new AbortController();

  constructor(private container: HTMLElement, private callbacks: ReaderCallbacks) {
    this.viewport.className = 'pdf-reader-viewport';
    this.transform.className = 'pdf-reader-transform';
    this.book.className = 'pdf-reader-book';
    this.transform.append(this.book);
    this.viewport.append(this.transform);
    this.container.append(this.viewport);
    const signal = this.abortEvents.signal;
    this.viewport.addEventListener('pointerdown', this.pointerDown, { signal });
    this.viewport.addEventListener('pointermove', this.pointerMove, { signal });
    this.viewport.addEventListener('pointerup', this.pointerUp, { signal });
    this.viewport.addEventListener('pointercancel', this.pointerUp, { signal });
    // StPageFlip uses mouse/touch events, so capture those before its handlers.
    for (const type of ['mousedown', 'mousemove', 'mouseup', 'touchstart', 'touchmove', 'touchend', 'click']) {
      this.viewport.addEventListener(type, this.suppressFlipWhenZoomed, { capture: true, passive: false, signal });
    }
    this.resizeObserver = new ResizeObserver(() => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.resize(), 100);
    });
    this.resizeObserver.observe(container);
  }

  get numPages() { return this.engine?.totalPages ?? 0; }
  get currentPage() { return this.numPages ? this.selected : 0; }
  get diagnostics() {
    return { cachedPages: this.engine?.cachedPages ?? 0, activeRenders: this.engine?.activeRenders ?? 0, totalPages: this.numPages, currentPage: this.currentPage };
  }

  async load(file: File): Promise<void> {
    if (this.destroyed) throw new Error('阅读器已关闭');
    const generation = ++this.generation;
    await this.releaseDocument();
    if (generation !== this.generation) return;
    this.callbacks.onProgress('正在本地打开 PDF…');
    this.selected = 1;
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    const engine = this.engine = new PdfEngine(this.callbacks, page => this.clearBitmap(page));
    try {
      const metadata = await engine.load(file);
      if (generation !== this.generation || this.destroyed) return;
      this.ratio = metadata.width / metadata.height;
      this.pages = Array.from({ length: engine.totalPages }, (_, index) => {
        const page = document.createElement('div');
        page.className = 'pdf-reader-page';
        page.dataset.page = String(index + 1);
        page.setAttribute('aria-label', `第 ${index + 1} 页`);
        const image = document.createElement('img');
        image.className = 'pdf-reader-page-image';
        image.alt = `PDF 第 ${index + 1} 页`;
        image.draggable = false;
        const placeholder = document.createElement('span');
        placeholder.className = 'pdf-reader-placeholder';
        placeholder.textContent = `第 ${index + 1} 页`;
        page.append(image, placeholder);
        return page;
      });
      this.measure();
      this.framesAlive = true;
      const flip: FlipBook = this.flip = new PageFlip(this.book, {
        width: this.pageWidth, height: this.pageHeight,
        size: 'fixed', autoSize: false, usePortrait: this.single, showCover: true,
        drawShadow: true, maxShadowOpacity: 0.24, flippingTime: 650,
        startZIndex: 2, mobileScrollSupport: false, swipeDistance: 28,
        clickEventForward: false, showPageCorners: true, useMouseEvents: true,
        disableFlipByClick: false,
      });
      flip.on('flip', event => {
        if (generation !== this.generation) return;
        this.selected = Math.max(1, Math.min(this.numPages, Number(event.data) + 1));
        this.pan = { x: 0, y: 0 };
        this.applyTransform();
        this.callbacks.onPage(this.selected, this.numPages);
        void this.renderNearby();
      });
      this.trackAnimationFrames(() => flip.loadFromHTML(this.pages));
      this.applyTransform();
      this.callbacks.onLoaded?.(metadata.fingerprint, this.numPages);
      this.callbacks.onPage(this.selected, this.numPages);
      await this.renderNearby();
      if (generation === this.generation) this.callbacks.onProgress('');
    } catch (error) {
      if (generation !== this.generation || this.destroyed) return;
      if (isCancelled(error)) { await this.releaseDocument(); throw error; }
      const message = friendlyPdfError(error);
      this.callbacks.onError(message);
      await this.releaseDocument();
      throw new Error(message);
    }
  }

  next() {
    if (!this.flip) return;
    const start = this.flip.getCurrentPageIndex() + 1;
    if (start >= this.numPages || (!this.single && start > 1 && start + 1 >= this.numPages)) return;
    this.finishAnimation();
    this.flip.flipNext();
  }

  prev() {
    if (!this.flip || this.selected <= 1) return;
    this.finishAnimation();
    this.flip.flipPrev();
  }

  goTo(page: number) {
    if (!this.flip || !Number.isFinite(page)) return;
    const target = Math.max(1, Math.min(this.numPages, Math.trunc(page)));
    this.finishAnimation();
    this.flip.turnToPage(target - 1);
    // PageFlip reports the first page of a spread; retain an explicit requested page.
    this.selected = target;
    this.pan = { x: 0, y: 0 };
    this.applyTransform();
    this.callbacks.onPage(target, this.numPages);
    void this.renderNearby();
  }

  setLayout(layout: ReaderLayout) {
    if (!['auto', 'single', 'double'].includes(layout)) return;
    this.layout = layout;
    this.resize();
  }

  setZoom(value: number) {
    if (!Number.isFinite(value)) return;
    this.finishAnimation();
    this.zoom = Math.min(3, Math.max(1, value));
    this.pan = { x: 0, y: 0 };
    this.applyTransform();
    void this.renderNearby();
  }

  fit() { this.setZoom(1); }

  resize() {
    if (!this.flip || this.destroyed) return;
    const page = this.selected;
    this.finishAnimation();
    this.measure();
    const settings = this.flip.getSettings();
    settings.width = this.pageWidth;
    settings.height = this.pageHeight;
    settings.usePortrait = this.single;
    this.flip.update();
    this.flip.turnToPage(page - 1);
    this.selected = page;
    this.pan = { x: 0, y: 0 };
    this.applyTransform();
    this.callbacks.onPage(page, this.numPages);
    void this.renderNearby();
  }

  async renderThumbnail(page: number, canvas: HTMLCanvasElement): Promise<void> {
    if (!this.engine || page < 1 || page > this.numPages) return;
    try { await this.engine.renderThumbnail(page, canvas); }
    catch (error) { if (!isCancelled(error) && !this.destroyed) throw error; }
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.generation++;
    clearTimeout(this.resizeTimer);
    this.resizeObserver.disconnect();
    this.abortEvents.abort();
    await this.releaseDocument();
    this.viewport.remove();
  }

  private measure() {
    const width = Math.max(80, this.container.clientWidth - 40);
    const height = Math.max(80, this.container.clientHeight - 40);
    this.single = this.layout === 'single' || (this.layout === 'auto' && width < 760);
    const columns = this.single ? 1 : 2;
    this.pageWidth = Math.max(30, Math.floor(Math.min(width / columns, height * this.ratio)));
    this.pageHeight = Math.max(30, Math.floor(this.pageWidth / this.ratio));
    this.transform.style.width = `${this.pageWidth * columns}px`;
    this.transform.style.height = `${this.pageHeight}px`;
    this.viewport.dataset.layout = this.single ? 'single' : 'double';
  }

  private applyTransform() {
    this.viewport.classList.toggle('pdf-reader-zoomed', this.zoom > 1);
    const columns = this.single ? 1 : 2;
    const maximumX = Math.max(0, (this.pageWidth * columns * this.zoom - this.viewport.clientWidth + 40) / 2);
    const maximumY = Math.max(0, (this.pageHeight * this.zoom - this.viewport.clientHeight + 40) / 2);
    this.pan.x = Math.min(maximumX, Math.max(-maximumX, this.pan.x));
    this.pan.y = Math.min(maximumY, Math.max(-maximumY, this.pan.y));
    this.transform.style.transform = `translate(calc(-50% + ${this.pan.x}px), calc(-50% + ${this.pan.y}px)) scale(${this.zoom})`;
  }

  private async renderNearby() {
    const engine = this.engine;
    if (!engine || !this.pages.length) return;
    const generation = ++this.renderGeneration;
    const start = this.single || this.selected === 1 ? this.selected : this.selected - (this.selected % 2);
    const visible = this.single || start === 1 ? [start] : [start, start + 1].filter(page => page <= this.numPages);
    const nearby = [...visible];
    // Eight total pages: visible spread followed by the next/previous spreads.
    for (let offset = 1; nearby.length < 8 && offset <= 8; offset++) {
      for (const page of [visible[visible.length - 1] + offset, start - offset]) {
        if (page >= 1 && page <= this.numPages && !nearby.includes(page)) nearby.push(page);
        if (nearby.length === 8) break;
      }
    }
    const pixels = Math.min(3, window.devicePixelRatio || 1) * this.zoom;
    const quality = `${Math.round(this.pageWidth)}x${Math.round(this.pageHeight)}@${pixels.toFixed(2)}`;
    engine.prioritize(nearby, quality);
    const visibleJobs: Promise<void>[] = [];
    for (const [priority, page] of nearby.entries()) {
      const cached = engine.peek(page);
      if (cached) this.applyBitmap(cached);
      const job = engine.render(page, this.pageWidth, this.pageHeight, pixels, priority).then(bitmap => {
        if (this.engine === engine && generation === this.renderGeneration) this.applyBitmap(bitmap);
      }).catch(error => {
        if (!isCancelled(error) && this.engine === engine && generation === this.renderGeneration) {
          this.book.querySelectorAll<HTMLElement>(`[data-page="${page}"] .pdf-reader-placeholder`).forEach(element => { element.textContent = `第 ${page} 页暂时无法显示`; });
          if (visible.includes(page)) this.callbacks.onError(`第 ${page} 页渲染失败，请尝试重新打开文件。`);
        }
      });
      if (visible.includes(page)) visibleJobs.push(job);
    }
    await Promise.all(visibleJobs);
  }

  private applyBitmap(bitmap: PageBitmap) {
    // Both the original and any portrait animation clone get the same image URL.
    this.book.querySelectorAll<HTMLElement>(`[data-page="${bitmap.page}"]`).forEach(page => {
      const image = page.querySelector<HTMLImageElement>('img');
      if (image && image.getAttribute('src') !== bitmap.url) image.src = bitmap.url;
      page.classList.add('pdf-reader-ready');
    });
  }

  private clearBitmap(pageNumber: number) {
    this.book.querySelectorAll<HTMLElement>(`[data-page="${pageNumber}"]`).forEach(page => {
      page.querySelector('img')?.removeAttribute('src');
      page.classList.remove('pdf-reader-ready');
    });
  }

  private finishAnimation() { if (this.flip && this.flip.getState() !== 'read') this.flip.getRender().finishAnimation(); }

  private pointerDown = (event: PointerEvent) => {
    if (this.zoom <= 1 || event.button !== 0) return;
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: this.pan.x, top: this.pan.y };
    this.viewport.setPointerCapture(event.pointerId);
    this.viewport.classList.add('pdf-reader-dragging');
    event.preventDefault();
  };
  private pointerMove = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.id) return;
    this.pan.x = this.drag.left + event.clientX - this.drag.x;
    this.pan.y = this.drag.top + event.clientY - this.drag.y;
    this.applyTransform();
  };
  private pointerUp = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.id) return;
    if (this.viewport.hasPointerCapture(event.pointerId)) this.viewport.releasePointerCapture(event.pointerId);
    this.drag = null;
    this.viewport.classList.remove('pdf-reader-dragging');
  };
  private suppressFlipWhenZoomed = (event: Event) => {
    if (this.zoom > 1) { event.stopImmediatePropagation(); if (event.cancelable) event.preventDefault(); }
  };

  /** StPageFlip 2.0.7 has no RAF stop method. Track its recursive frame only. */
  private trackAnimationFrames(action: () => void) {
    const original = window.requestAnimationFrame;
    const tracked: typeof window.requestAnimationFrame = callback => {
      const id = original.call(window, time => {
        this.animationFrames.delete(id);
        if (!this.framesAlive) return;
        const previous = window.requestAnimationFrame;
        window.requestAnimationFrame = tracked;
        try { callback(time); } finally { window.requestAnimationFrame = previous; }
      });
      this.animationFrames.add(id);
      return id;
    };
    window.requestAnimationFrame = tracked;
    try { action(); } finally { window.requestAnimationFrame = original; }
  }

  private async releaseDocument() {
    this.renderGeneration++;
    this.framesAlive = false;
    for (const frame of this.animationFrames) cancelAnimationFrame(frame);
    this.animationFrames.clear();
    if (this.flip) {
      // The upstream destructor omits its resize listener as well as its RAF.
      const ui = this.flip.getUI();
      if (ui.onResize) window.removeEventListener('resize', ui.onResize);
      for (const event of ['flip', 'init', 'changeOrientation', 'changeState']) this.flip.off(event);
      this.flip.destroy();
      this.flip = null;
    }
    this.pages = [];
    this.book.replaceChildren();
    if (!this.book.parentElement) this.transform.append(this.book);
    const engine = this.engine;
    this.engine = null;
    if (engine) await engine.destroy();
  }
}

function friendlyPdfError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'InvalidPDFException') return '这个文件不是有效的 PDF，或文件内容已经损坏。';
  if (name === 'PasswordException') return 'PDF 密码不正确，请重新打开后再试。';
  if (name === 'MissingPDFException') return '无法读取这个 PDF 文件，请重新选择。';
  return 'PDF 打开失败，请检查文件是否完整，或换一个文件重试。';
}
