import { getDocument, GlobalWorkerOptions, PasswordResponses } from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfCallbacks = {
  onProgress(text: string): void;
  onPassword?(retry: boolean): Promise<string | null>;
};
export type PageBitmap = { page: number; url: string; width: number; height: number; quality: string };
type Work = { key: string; page: number; priority: number; run(): Promise<unknown>; resolve(value: any): void; reject(reason: unknown): void };
const aborted = () => new DOMException('操作已取消', 'AbortError');
export const isCancelled = (error: unknown) => error instanceof Error && ['AbortError', 'RenderingCancelledException'].includes(error.name);

/** Owns one local PDF, a two-slot renderer, and at most eight decoded page bitmaps. */
export class PdfEngine {
  document: PDFDocumentProxy | null = null;
  private loading: PDFDocumentLoadingTask | null = null;
  private cache = new Map<number, PageBitmap>();
  private pending = new Map<string, Promise<any>>();
  private queue: Work[] = [];
  private running = new Map<string, Work>();
  private tasks = new Map<string, RenderTask>();
  private wanted = new Set<number>();
  private wantedQuality = '';
  private disposed = false;
  private generation = 0;

  constructor(private callbacks: PdfCallbacks, private evicted: (page: number) => void) {}

  get totalPages() { return this.document?.numPages ?? 0; }
  get cachedPages() { return this.cache.size; }
  get activeRenders() { return this.running.size; }

  async load(file: File): Promise<{ fingerprint: string; width: number; height: number }> {
    const generation = ++this.generation;
    const data = new Uint8Array(await file.arrayBuffer());
    if (this.disposed || generation !== this.generation) throw aborted();
    const base = `${import.meta.env.BASE_URL}vendor/pdfjs/`;
    // Older PDF.js accepts isEvalSupported; 6.x removed dynamic evaluation and this option.
    const parameters = {
      data, cMapUrl: `${base}cmaps/`, cMapPacked: true,
      standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/`,
      isEvalSupported: false,
    };
    const task = this.loading = getDocument(parameters);
    let passwordCancelled = false;
    task.onPassword = (update: (password: string) => void, reason: number) => {
      void (async () => {
        const value = await this.callbacks.onPassword?.(reason === PasswordResponses.INCORRECT_PASSWORD);
        if (this.disposed || generation !== this.generation) return;
        if (value == null) { passwordCancelled = true; void task.destroy().catch(() => {}); return; }
        update(value);
      })().catch(() => { passwordCancelled = true; void task.destroy().catch(() => {}); });
    };
    task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
      if (!this.disposed) this.callbacks.onProgress(total ? `正在读取 PDF · ${Math.min(100, Math.round(loaded / total * 100))}%` : '正在读取 PDF…');
    };
    const document = await task.promise.catch(error => { if (passwordCancelled) throw aborted(); throw error; });
    if (this.disposed || generation !== this.generation) { await document.loadingTask.destroy(); throw aborted(); }
    this.document = document;
    const first = await document.getPage(1);
    if (this.disposed) throw aborted();
    const viewport = first.getViewport({ scale: 1 });
    return { fingerprint: document.fingerprints[0] ?? `${file.name}:${file.size}:${file.lastModified}`, width: viewport.width, height: viewport.height };
  }

  peek(page: number): PageBitmap | undefined { return this.cache.get(page); }

  /** Cancel obsolete renders when jumping or resizing; visible pages always enter the queue first. */
  prioritize(pages: number[], quality?: string) {
    this.wanted = new Set(pages);
    if (quality) this.wantedQuality = quality;
    for (const work of [...this.queue]) {
      if (!work.key.startsWith('page:')) continue;
      if (!this.wanted.has(work.page) || (quality && !work.key.endsWith(`:${quality}`))) {
        this.queue.splice(this.queue.indexOf(work), 1);
        this.pending.delete(work.key);
        work.reject(aborted());
      } else work.priority = pages.indexOf(work.page);
    }
    for (const [key, work] of this.running) {
      if (key.startsWith('page:') && (!this.wanted.has(work.page) || (quality && !key.endsWith(`:${quality}`)))) this.tasks.get(key)?.cancel();
    }
    this.queue.sort((a, b) => a.priority - b.priority);
    // Removing distant cached images now also limits memory during fast jumps.
    for (const page of [...this.cache.keys()]) if (!this.wanted.has(page)) this.remove(page);
  }

  render(pageNumber: number, boxWidth: number, boxHeight: number, pixels: number, priority: number): Promise<PageBitmap> {
    const quality = `${Math.round(boxWidth)}x${Math.round(boxHeight)}@${pixels.toFixed(2)}`;
    const cached = this.cache.get(pageNumber);
    if (cached?.quality === quality) { this.cache.delete(pageNumber); this.cache.set(pageNumber, cached); return Promise.resolve(cached); }
    const key = `page:${pageNumber}:${quality}`;
    return this.schedule<PageBitmap>(key, pageNumber, priority, async () => {
      const document = this.document;
      if (!document || this.disposed) throw aborted();
      const page = await document.getPage(pageNumber);
      if (this.disposed || !this.wanted.has(pageNumber) || this.wantedQuality !== quality) throw aborted();
      const view = page.getViewport({ scale: 1 });
      let scale = Math.min(boxWidth / view.width, boxHeight / view.height) * pixels;
      // Avoid exhausting a mobile GPU on a very large PDF or a 3× retina zoom.
      scale = Math.min(scale, Math.sqrt(16_000_000 / (view.width * view.height)), 8192 / Math.max(view.width, view.height));
      const viewport = page.getViewport({ scale });
      const canvas = documentCreateCanvas();
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      try {
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('浏览器无法创建 PDF 画布');
        const task = page.render({ canvas, canvasContext: context, viewport, background: '#ffffff' });
        this.tasks.set(key, task);
        await task.promise;
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('页面图像生成失败')), 'image/png'));
        if (this.disposed || !this.wanted.has(pageNumber) || this.wantedQuality !== quality) throw aborted();
        const result: PageBitmap = { page: pageNumber, url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height, quality };
        this.remove(pageNumber);
        this.cache.set(pageNumber, result);
        while (this.cache.size > 8) this.remove(this.cache.keys().next().value!);
        return result;
      } finally {
        this.tasks.delete(key);
        canvas.width = canvas.height = 0;
        page.cleanup();
      }
    }).catch(error => {
      // A quick jump away and back can reuse a render just cancelled by the previous jump.
      if (isCancelled(error) && !this.disposed && this.wanted.has(pageNumber) && this.wantedQuality === quality) {
        return this.render(pageNumber, boxWidth, boxHeight, pixels, priority);
      }
      throw error;
    });
  }

  renderThumbnail(pageNumber: number, canvas: HTMLCanvasElement): Promise<void> {
    const key = `thumb:${pageNumber}:${crypto.randomUUID()}`;
    return this.schedule<void>(key, pageNumber, 100, async () => {
      if (!this.document || this.disposed) throw aborted();
      const page = await this.document.getPage(pageNumber);
      if (this.disposed) throw aborted();
      const original = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(280 / original.width, 360 / original.height) });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('无法创建缩略图画布');
      const task = page.render({ canvas, canvasContext: context, viewport, background: '#ffffff' });
      this.tasks.set(key, task);
      try { await task.promise; } finally { this.tasks.delete(key); page.cleanup(); }
    });
  }

  private schedule<T>(key: string, page: number, priority: number, run: () => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(aborted());
    const existing = this.pending.get(key);
    if (existing) return existing;
    const promise = new Promise<T>((resolve, reject) => {
      this.queue.push({ key, page, priority, run, resolve, reject });
    });
    this.pending.set(key, promise);
    this.pump();
    return promise;
  }

  private pump() {
    this.queue.sort((a, b) => a.priority - b.priority);
    while (!this.disposed && this.running.size < 2 && this.queue.length) {
      const work = this.queue.shift()!;
      this.running.set(work.key, work);
      const finish = () => {
        this.pending.delete(work.key);
        this.running.delete(work.key);
        this.pump();
      };
      void work.run().then(value => { finish(); work.resolve(value); }, error => { finish(); work.reject(error); });
    }
  }

  private remove(page: number) {
    const value = this.cache.get(page);
    if (!value) return;
    this.evicted(page);
    URL.revokeObjectURL(value.url);
    this.cache.delete(page);
  }

  async destroy() {
    this.disposed = true;
    this.generation++;
    for (const work of this.queue) work.reject(aborted());
    this.queue = [];
    for (const task of this.tasks.values()) task.cancel();
    for (const page of [...this.cache.keys()]) this.remove(page);
    const loading = this.loading;
    this.loading = null;
    this.document = null;
    if (loading) await loading.destroy();
    await Promise.allSettled(this.pending.values());
    this.pending.clear();
  }
}

const documentCreateCanvas = () => document.createElement('canvas');
