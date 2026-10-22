import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { SwipeDetector, type FlipDirection, type HandSample, type Sensitivity } from './gesture-detector';

export type GestureState = 'loading' | 'searching' | 'ready' | 'cooldown' | 'error' | 'off';
export interface GestureCallbacks {
  onStatus(text: string, state: GestureState): void;
  onFlip(direction: FlipDirection): void;
}
const cancelled = () => new DOMException('操作已取消', 'AbortError');
const stopStream = (stream: MediaStream) => stream.getTracks().forEach(track => track.stop());

/** Webcam stays off until start() is explicitly called. No automatic retries or restarts. */
export class GestureController {
  private wanted = false;
  private generation = 0;
  private abort: AbortController | null = null;
  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  private model: HandLandmarker | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private lastVideoTime = -1;
  private lastSubmit = 0;
  private fallback = false;
  private lastStatus = '';
  private detector = new SwipeDetector();
  private readonly onHidden = () => {
    if (document.hidden && this.wanted) {
      this.stop(); this.status('页面已隐藏，摄像头已关闭；返回后请手动开启。', 'off');
    }
  };
  private readonly onPageHide = () => this.stop();

  constructor(private video: HTMLVideoElement, private callbacks: GestureCallbacks) {}
  get active(): boolean { return this.wanted; }
  setSensitivity(value: Sensitivity): void { this.detector.setSensitivity(value); }

  async start(): Promise<void> {
    if (this.wanted) return;
    const token = ++this.generation;
    this.wanted = true; this.abort = new AbortController(); this.detector.reset();
    this.lastVideoTime = -1; this.lastSubmit = 0; this.fallback = false;
    document.addEventListener('visibilitychange', this.onHidden);
    window.addEventListener('pagehide', this.onPageHide);
    this.status('正在请求摄像头权限…', 'loading');
    try {
      if (!window.isSecureContext) throw new Error('摄像头需要安全连接：请使用 localhost 或 HTTPS 打开。');
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器不支持摄像头访问，请使用新版 Chrome、Edge 或 Safari。');
      if (document.hidden) throw new Error('请在当前可见页面开启摄像头。');
      const streamPromise = navigator.mediaDevices.getUserMedia({ audio: false,
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 20, max: 30 } } });
      const stream = await this.bounded(streamPromise.then(result => {
        if (!this.current(token)) { stopStream(result); throw cancelled(); }
        return result;
      }), 30000, '摄像头权限等待超时。请检查地址栏权限后重新开启。');
      if (!this.current(token)) { stopStream(stream); return; }
      this.stream = stream;
      stream.getVideoTracks().forEach(track => { track.onended = () => {
        if (this.current(token)) this.fail('摄像头连接已断开，请检查设备后重新开启。');
      }; });
      this.video.srcObject = stream; this.video.muted = true; this.video.playsInline = true;
      await this.bounded(this.video.play(), 8000, '摄像头画面启动超时，请检查设备后重新开启。');
      this.status('正在加载本地手部模型…', 'loading');
      try { await this.initWorker(token); }
      catch (error) {
        if (!this.current(token)) return;
        this.worker?.terminate(); this.worker = null;
        this.fallback = true;
        this.status('后台推理不可用，正在启动兼容模式（约 6 帧/秒，低性能设备可能短暂卡顿）…', 'loading');
        try { await this.initMainThread(token); }
        catch (modelError) {
          if (!this.current(token)) return;
          throw new Error(`本地手部模型启动失败：${modelError instanceof Error ? modelError.message : '无法读取模型'}。请确认 vendor/mediapipe 中模型与 WASM 文件完整，再重新开启。`);
        }
      }
      if (!this.current(token)) return;
      this.status(this.hint('请将张开的手掌保持稳定约半秒，等待就绪。'), 'searching');
      this.queueFrame(token);
    } catch (error) {
      if (!this.current(token)) return;
      this.fail(this.describeError(error));
    }
  }

  stop(): void {
    this.wanted = false; this.generation++; this.release(); this.detector.reset();
    this.status('摄像头已关闭', 'off');
  }
  private current(token: number): boolean { return this.wanted && token === this.generation; }
  private status(text: string, state: GestureState): void {
    const key = `${state}:${text}`;
    if (key !== this.lastStatus) { this.lastStatus = key; this.callbacks.onStatus(text, state); }
  }
  private hint(text: string): string { return this.fallback ? `兼容模式 · ${text}` : text; }
  private fail(message: string): void {
    this.wanted = false; this.generation++; this.release(); this.detector.reset(); this.status(message, 'error');
  }
  private release(): void {
    this.abort?.abort(); this.abort = null;
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    if (this.watchdog) clearTimeout(this.watchdog); this.watchdog = null;
    this.worker?.terminate(); this.worker = null;
    this.model?.close(); this.model = null;
    if (this.stream) { this.stream.getTracks().forEach(track => { track.onended = null; }); stopStream(this.stream); }
    this.stream = null; this.video.pause(); this.video.srcObject = null; this.inFlight = false;
    document.removeEventListener('visibilitychange', this.onHidden);
    window.removeEventListener('pagehide', this.onPageHide);
  }
  private bounded<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    const signal = this.abort?.signal;
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return; settled = true; clearTimeout(timeout); signal?.removeEventListener('abort', abort); fn();
      };
      const abort = () => done(() => reject(cancelled()));
      const timeout = setTimeout(() => done(() => reject(new Error(message))), ms);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      promise.then(value => done(() => resolve(value)), error => done(() => reject(error)));
    });
  }
  private async initWorker(token: number): Promise<void> {
    if (typeof Worker === 'undefined' || typeof createImageBitmap !== 'function') throw new Error('浏览器不支持后台视频帧');
    const { default: gestureWorkerUrl } = await import('./gesture.worker.ts?worker&url');
    if (!this.current(token)) throw cancelled();
    // MediaPipe's WASM loader uses classic-script global ModuleFactory. Vite emits
    // the production worker as IIFE; the dev server serves ES modules instead.
    const worker = new Worker(gestureWorkerUrl, { type: import.meta.env.DEV ? 'module' : 'classic' });
    this.worker = worker;
    const base = new URL(import.meta.env.BASE_URL, location.href);
    await this.bounded(new Promise<void>((resolve, reject) => {
      worker.onerror = event => { event.preventDefault(); reject(new Error(event.message || '后台模型无法启动')); };
      worker.onmessage = event => {
        if (event.data.type === 'ready') resolve();
        if (event.data.type === 'error') reject(new Error(event.data.message));
      };
      worker.postMessage({ type: 'init', wasmPath: new URL('vendor/mediapipe/wasm/', base).href,
        modelPath: new URL('vendor/mediapipe/hand_landmarker.task', base).href });
    }), 20000, '后台手部模型加载超时');
    if (!this.current(token)) return;
    worker.onerror = event => {
      event.preventDefault(); if (this.current(token)) this.fail('后台手势推理中断，请重新开启。');
    };
    worker.onmessage = event => {
      if (!this.current(token)) return;
      if (this.watchdog) clearTimeout(this.watchdog); this.watchdog = null;
      this.inFlight = false;
      if (event.data.type === 'error') { this.fail(`手势推理失败：${event.data.message}。请重新开启。`); return; }
      if (event.data.type === 'result') { this.consume(event.data); this.queueFrame(token); }
    };
  }
  private async initMainThread(token: number): Promise<void> {
    const operation = (async () => {
      const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
      if (!this.current(token)) throw cancelled();
      const base = import.meta.env.BASE_URL;
      const files = await FilesetResolver.forVisionTasks(`${base}vendor/mediapipe/wasm/`);
      if (!this.current(token)) throw cancelled();
      const result = await HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: `${base}vendor/mediapipe/hand_landmarker.task`, delegate: 'CPU' },
        runningMode: 'VIDEO', numHands: 1,
        minHandDetectionConfidence: 0.7, minHandPresenceConfidence: 0.7, minTrackingConfidence: 0.7,
      });
      if (!this.current(token)) { result.close(); throw cancelled(); }
      return result;
    })();
    this.model = await this.bounded(operation, 20000, '本地手部模型加载超时，请确认 vendor 模型与 WASM 文件完整后重新开启。');
  }
  private queueFrame(token: number): void {
    if (!this.current(token) || this.inFlight) return;
    const interval = this.fallback ? 165 : 80;
    this.timer = setTimeout(() => { this.timer = null; void this.frame(token); }, Math.max(0, interval - (performance.now() - this.lastSubmit)));
  }
  private async frame(token: number): Promise<void> {
    if (!this.current(token)) return;
    if (document.hidden) { this.onHidden(); return; }
    if (this.video.readyState < 2 || this.video.currentTime === this.lastVideoTime) { this.lastSubmit = performance.now(); this.queueFrame(token); return; }
    this.inFlight = true; this.lastSubmit = performance.now(); this.lastVideoTime = this.video.currentTime;
    try {
      if (this.worker) {
        const bitmap = await createImageBitmap(this.video, { resizeWidth: 640, resizeQuality: 'low' });
        if (!this.current(token) || !this.worker) { bitmap.close(); return; }
        try { this.worker.postMessage({ type: 'frame', bitmap, time: this.lastSubmit }, [bitmap]); }
        catch (error) { bitmap.close(); throw error; }
        this.watchdog = setTimeout(() => {
          if (this.current(token)) this.fail('手势推理响应超时，摄像头已关闭。请重新开启。');
        }, 8000);
      } else if (this.model) {
        const result = this.model.detectForVideo(this.video, this.lastSubmit);
        this.consume({ time: this.lastSubmit, landmarks: result.landmarks[0] ?? null,
          confidence: result.handedness[0]?.[0]?.score ?? 0 });
        this.inFlight = false; this.queueFrame(token);
      }
    } catch (error) { if (this.current(token)) this.fail(`无法读取摄像头画面：${this.describeError(error)}`); }
  }
  private consume(sample: HandSample): void {
    const result = this.detector.update(sample);
    if (result.direction) this.callbacks.onFlip(result.direction);
    if (result.phase === 'ready') this.status(this.hint('已就绪 · 左挥下一页，右挥上一页'), 'ready');
    else if (result.phase === 'cooldown') this.status(this.hint('翻页后请停稳手掌，等待再次就绪'), 'cooldown');
    else this.status(this.hint('寻找张开的手掌 · 请保持稳定约半秒'), 'searching');
  }
  private describeError(error: unknown): string {
    if (error instanceof DOMException) {
      if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return '摄像头权限被拒绝。请在地址栏允许摄像头后手动重新开启。';
      if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') return '未找到摄像头，请连接设备后重新开启。';
      if (error.name === 'NotReadableError' || error.name === 'TrackStartError') return '摄像头被其他应用占用或无法读取，请释放设备后重新开启。';
      if (error.name === 'OverconstrainedError') return '摄像头不支持当前采集设置，请切换设备后重新开启。';
    }
    return error instanceof Error ? error.message : '摄像头或手部模型启动失败，请检查设备与本地模型文件后重新开启。';
  }
}
