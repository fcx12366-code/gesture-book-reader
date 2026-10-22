import './style.css';
import { icon } from './icons';
import { PdfReader } from './reader';
import { GestureController } from './gesture';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
<input id="file-input" data-testid="import-input" type="file" accept=".pdf,application/pdf" hidden />
<section id="welcome" class="welcome">
 <header class="landing-header"><a class="brand" href="./" aria-label="纸间首页"><span class="brand-mark">${icon('book')}</span><span>纸间<span class="brand-sub">PDF 阅读器</span></span></a><span class="privacy-pill">${icon('lock')}只在你的设备上</span></header>
 <main class="welcome-main">
  <div class="intro"><span class="eyebrow"><span></span> 留一刻，给阅读</span><h1>在纸间，<br>静下来阅读。</h1><p class="intro-copy">导入你的 PDF，像翻一本书一样阅读。<br>也可以打开摄像头，用一次挥手，翻过一页。</p><div class="intro-details"><span>${icon('file')}保留原始排版</span><span>${icon('hand')}挥手轻轻翻页</span></div><p id="resume-hint" class="resume-hint" hidden></p></div>
  <div class="import-card" id="import-zone" data-testid="import-zone" role="region" aria-label="PDF 拖拽导入区域">
   <div class="paper-illustration" aria-hidden="true"><div class="paper-back"></div><div class="paper-cover"><span class="paper-small">留一刻 · 给阅读</span><div class="paper-drawing"><i></i><i></i><i></i></div><span class="paper-title">纸 间</span><span class="paper-rule"></span><span class="paper-bottom">你的书，你的阅读时光</span></div></div>
   <h2>把你的书放在这里</h2><p>将 PDF 拖入此处，或选择一个本地文件</p><button class="button primary import-trigger" id="import-button">${icon('upload')}导入 PDF</button><span class="import-footnote">PDF 本地解析 · 无需账号 · 不上传文件</span>
  </div>
 </main>
 <footer class="landing-footer"><span>一本书，一段专注的时光。</span><span>${icon('keyboard')} 方向键翻页 <span class="footer-dot">·</span> 手机轻扫翻页</span></footer>
</section>
<section id="reading-view" class="reading-view" data-testid="reader" hidden>
 <header class="reader-header"><div class="reading-identity"><button id="close-reader" data-testid="close-reader" class="brand brand-button" title="退出阅读，返回首页" aria-label="退出阅读，返回首页"><span class="brand-mark">${icon('book')}</span><span class="reader-brand-word">纸间</span></button><span class="identity-divider"></span><div class="filename-wrap"><span id="filename"></span><span class="local-caption">本地 PDF</span></div></div><div class="header-actions"><button class="button subtle" id="change-file" data-testid="change-file">${icon('upload')}<span>更换文件</span></button><button class="button gesture-button" id="gesture-toggle" data-testid="gesture-toggle" aria-pressed="false">${icon('hand')}<span>开启手势</span></button></div></header>
 <nav class="toolbar" aria-label="阅读工具栏"><div class="toolbar-group"><button class="tool" id="thumbnails-toggle" data-testid="thumbnails-toggle" title="缩略图目录" aria-label="缩略图目录" aria-expanded="false">${icon('grid')}</button><span class="toolbar-divider"></span><button class="tool" id="prev-page" data-testid="prev-page" title="上一页（←）" aria-label="上一页">${icon('left')}</button><form id="page-form" class="page-form"><input id="page-input" data-testid="page-input" aria-label="跳转页码" type="number" min="1" value="1" inputmode="numeric"/><span class="page-slash">/</span><span id="page-total" data-testid="page-total">0</span><button type="submit" class="sr-only">跳转</button></form><button class="tool" id="next-page" data-testid="next-page" title="下一页（→）" aria-label="下一页">${icon('right')}</button></div><div class="toolbar-group view-controls"><label class="select-wrap"><span class="sr-only">阅读布局</span><select id="layout-select" data-testid="layout-select" aria-label="阅读布局"><option value="auto">自动单双页</option><option value="single">单页阅读</option><option value="double">双页阅读</option></select></label><span class="toolbar-divider"></span><label class="select-wrap zoom-wrap"><span class="sr-only">缩放</span><select id="zoom-select" data-testid="zoom-select" aria-label="缩放"><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option><option value="3">300%</option></select></label><button class="tool" id="fit-page" data-testid="fit-page" title="适应窗口，重置缩放" aria-label="适应窗口">${icon('fit')}</button><button class="tool" id="fullscreen" title="全屏" aria-label="全屏">${icon('expand')}</button></div></nav>
 <div class="reader-body"><aside id="thumbnails" class="thumbnails" aria-label="缩略图目录" hidden><div class="aside-heading"><span>页面目录</span><button class="tool" id="thumbnails-close" aria-label="收起目录">${icon('close')}</button></div><div id="thumbnail-scroll" class="thumbnail-scroll"></div></aside><div id="book-stage" class="book-stage" aria-label="PDF 页面"></div></div>
 <footer class="reader-footer"><span id="reading-hint">左右方向键翻页 · 轻扫书页翻页</span><span id="reading-progress">0%</span><div class="reading-progress-track"><div id="progress-fill"></div></div></footer>
 <aside id="gesture-panel" class="gesture-panel" aria-label="摄像头手势控制" hidden><div class="gesture-panel-heading"><span>${icon('hand')}手势翻页</span><button class="tool" id="preview-toggle" title="收起摄像头预览" aria-label="收起摄像头预览" aria-expanded="true">${icon('minus')}</button></div><div id="preview-content"><div class="video-wrap"><video id="camera-video" muted playsinline autoplay></video><div class="video-guide"></div><span class="video-label">镜像预览 · 不录像</span></div><p class="gesture-directions"><span>← 左挥 下一页</span><span>右挥 上一页 →</span></p><label class="sensitivity-label">灵敏度<select id="sensitivity" aria-label="手势灵敏度"><option value="low">低</option><option value="medium" selected>中</option><option value="high">高</option></select></label><p class="gesture-tip">张开手掌，横向挥动。翻页后停稳复位，再挥下一次。</p></div><p class="gesture-status" id="gesture-status" data-testid="gesture-status" role="status" aria-live="polite"><span class="status-dot"></span><span id="gesture-status-text">手势已关闭</span></p></aside>
</section>
<div id="loading" class="loading-overlay" hidden><div class="loading-card" role="status" aria-live="polite"><span class="spinner"></span><strong>正在打开你的书</strong><span id="loading-text">正在读取 PDF…</span><button id="cancel-load" class="button subtle">取消</button></div></div>
<div id="drop-overlay" class="drop-overlay" hidden>${icon('upload')}<strong>松开，打开这份 PDF</strong><span>文件只会在你的浏览器中处理</span></div>
<div id="error-toast" class="error-toast" hidden role="alert">${icon('warning')}<span id="error-message" data-testid="error-message"></span><button class="tool" id="dismiss-error" aria-label="关闭提示">${icon('close')}</button></div>
<dialog id="password-dialog"><form id="password-form"><span class="password-icon">${icon('lock')}</span><h2>这本书需要密码</h2><p id="password-message">输入 PDF 的打开密码，在本地解锁阅读。</p><input id="password-input" type="password" aria-label="PDF 打开密码" placeholder="输入密码" required autocomplete="off"/><div class="dialog-buttons"><button type="button" class="button subtle" id="password-cancel">取消</button><button type="submit" class="button primary">解锁 PDF</button></div></form></dialog>`;

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fileInput = el<HTMLInputElement>('file-input');
const pageInput = el<HTMLInputElement>('page-input');
const layoutSelect = el<HTMLSelectElement>('layout-select');
const zoomSelect = el<HTMLSelectElement>('zoom-select');
type Layout = 'auto' | 'single' | 'double';
type Sensitivity = 'low' | 'medium' | 'high';
type Saved = { name: string; page: number; layout: Layout; zoom: number; sensitivity: Sensitivity; updated: number };
type Library = { files: Record<string, Saved>; last: string | null };
let library: Library;
try { library = JSON.parse(localStorage.getItem('zhijian-reading-v1') || '{"files":{},"last":null}'); if (!library.files) throw Error(); }
catch { library = { files: {}, last: null }; }
let reader: PdfReader | null = null;
let fingerprint = '';
let filename = '';
let loading = false;
let session = 0;
let currentPage = 1;
let totalPages = 0;
let sensitivity: Sensitivity = 'medium';
let gestureWanted = false;
let previewExpanded = true;
let passwordResolve: ((value: string | null) => void) | null = null;
const camera = new GestureController(el<HTMLVideoElement>('camera-video'), {
 onFlip(direction) { if (loading || !reader) return; direction === 'next' ? reader.next() : reader.prev(); },
 onStatus(text, state) {
  el('gesture-status-text').textContent = text;
  el('gesture-status').dataset.state = state;
  if (state === 'error' || state === 'off') { gestureWanted = false; updateGestureButton(); }
 },
});
function updateGestureButton() {
 const button = el<HTMLButtonElement>('gesture-toggle');
 button.setAttribute('aria-pressed', String(gestureWanted));
 button.querySelector('span')!.textContent = gestureWanted ? '关闭手势' : '开启手势';
}
function showError(message: string) { el('error-message').textContent = message; el('error-toast').hidden = false; }
function clearError() { el('error-toast').hidden = true; }
function save() {
 if (!reader || !fingerprint || loading) return;
 library.files[fingerprint] = { name: filename, page: currentPage, layout: layoutSelect.value as Layout, zoom: +zoomSelect.value, sensitivity, updated: Date.now() };
 library.last = fingerprint;
 const entries = Object.entries(library.files).sort((a, b) => b[1].updated - a[1].updated).slice(0, 30);
 library.files = Object.fromEntries(entries);
 try { localStorage.setItem('zhijian-reading-v1', JSON.stringify(library)); } catch { /* 阅读仍可继续。 */ }
}
function resumeHint() {
 const last = library.last && library.files[library.last];
 el('resume-hint').hidden = !last;
 if (last) el('resume-hint').textContent = `上次读到「${last.name}」第 ${last.page} 页。刷新后需重新选择本地 PDF；选择同一文件即可恢复进度。`;
}
resumeHint();
function pageChanged(page: number, total: number) {
 currentPage = page; totalPages = total;
 pageInput.value = String(page); pageInput.max = String(total);
 el('page-total').textContent = String(total);
 const percent = total ? Math.round(page / total * 100) : 0;
 el('reading-progress').textContent = `${percent}%`;
 el('progress-fill').style.width = `${percent}%`;
 el<HTMLButtonElement>('prev-page').disabled = page <= 1;
 const double = el('book-stage').querySelector<HTMLElement>('.pdf-reader-viewport')?.dataset.layout === 'double';
 el<HTMLButtonElement>('next-page').disabled = page >= total || !!(double && page > 1 && page % 2 === 0 && page + 1 >= total);
 document.querySelectorAll<HTMLElement>('.thumbnail').forEach((item) => item.setAttribute('aria-current', String(+item.dataset.page! === page)));
 save();
}
function requestPassword(retry: boolean): Promise<string | null> {
 return new Promise((resolve) => {
  passwordResolve?.(null); passwordResolve = resolve;
  el('password-message').textContent = retry ? '密码不正确，请重新输入。' : '输入 PDF 的打开密码，在本地解锁阅读。';
  el<HTMLInputElement>('password-input').value = '';
  const dialog = el<HTMLDialogElement>('password-dialog');
  if (!dialog.open) dialog.showModal();
  el<HTMLInputElement>('password-input').focus();
 });
}
function finishPassword(value: string | null) { el<HTMLDialogElement>('password-dialog').close(); passwordResolve?.(value); passwordResolve = null; }
el('password-form').addEventListener('submit', (event) => { event.preventDefault(); finishPassword(el<HTMLInputElement>('password-input').value); });
el('password-cancel').addEventListener('click', () => finishPassword(null));
el('password-dialog').addEventListener('cancel', (event) => { event.preventDefault(); finishPassword(null); });

async function openPdf(file: File) {
 if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') { showError('请选择 PDF 格式的文件。'); return; }
 const token = ++session;
 save(); loading = true;
 stopGesture(); closeThumbnails(); clearError();
 finishPassword(null);
 const previous = reader; reader = null;
 await previous?.destroy();
 if (token !== session) return;
 fingerprint = ''; filename = file.name;
 el('filename').textContent = file.name; el('filename').title = file.name;
 el('welcome').hidden = true; el('reading-view').hidden = false;
 el('loading').hidden = false; el('loading-text').textContent = '正在读取 PDF…';
 const active = new PdfReader(el('book-stage'), {
  onPage: pageChanged,
  onProgress(text) { if (token === session) el('loading-text').textContent = text; },
  onError(message) { if (token === session) showError(message); },
  onLoaded(value) { if (token === session) fingerprint = value; },
  onPassword: requestPassword,
 });
 reader = active;
 try {
  await active.load(file);
  if (token !== session) return;
  const saved = library.files[fingerprint];
  layoutSelect.value = saved?.layout || 'auto';
  zoomSelect.value = String(saved?.zoom || 1);
  sensitivity = saved?.sensitivity || 'medium';
  el<HTMLSelectElement>('sensitivity').value = sensitivity;
  camera.setSensitivity(sensitivity);
  active.setLayout(layoutSelect.value as Layout);
  active.setZoom(+zoomSelect.value);
  if (saved) active.goTo(Math.max(1, Math.min(saved.page, active.numPages)));
  updateReadingHint();
  loading = false; el('loading').hidden = true; save();
 } catch (error) {
  if (token !== session) return;
  loading = false; el('loading').hidden = true;
  await active.destroy(); reader = null;
  el('reading-view').hidden = true; el('welcome').hidden = false;
  const message = error instanceof Error ? error.message : '无法打开这份 PDF，请重新选择。';
  if (!/取消|cancel/i.test(message)) showError(message);
  resumeHint();
 }
}
async function closeReader() {
 save(); ++session; loading = false;
 finishPassword(null); stopGesture(); closeThumbnails();
 el('loading').hidden = true;
 const previous = reader; reader = null; fingerprint = '';
 await previous?.destroy();
 el('reading-view').hidden = true; el('welcome').hidden = false; clearError(); resumeHint();
 if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
}
fileInput.addEventListener('change', () => { const file = fileInput.files?.[0]; fileInput.value = ''; if (file) void openPdf(file); });
document.querySelectorAll('.import-trigger, #change-file').forEach((button) => button.addEventListener('click', () => fileInput.click()));
el('close-reader').addEventListener('click', () => void closeReader());
el('cancel-load').addEventListener('click', () => void closeReader());
el('dismiss-error').addEventListener('click', clearError);
el('next-page').addEventListener('click', () => reader?.next());
el('prev-page').addEventListener('click', () => reader?.prev());
el('page-form').addEventListener('submit', (event) => {
 event.preventDefault();
 const page = +pageInput.value;
 if (!Number.isInteger(page) || page < 1 || page > totalPages) { showError(`请输入 1 到 ${totalPages} 之间的页码。`); return; }
 reader?.goTo(page); pageInput.blur();
});
document.addEventListener('keydown', (event) => {
 if (!reader || loading || event.ctrlKey || event.metaKey || event.altKey || el<HTMLDialogElement>('password-dialog').open) return;
 if ((event.target as HTMLElement).closest('input, select, textarea, [contenteditable]')) return;
 if (event.key === 'ArrowRight') { event.preventDefault(); reader.next(); }
 if (event.key === 'ArrowLeft') { event.preventDefault(); reader.prev(); }
});
function updateReadingHint() { el('reading-hint').textContent = +zoomSelect.value > 1 ? '放大阅读 · 拖动查看 · 使用按钮或方向键翻页' : '左右方向键翻页 · 轻扫书页翻页'; }
layoutSelect.addEventListener('change', () => { reader?.setLayout(layoutSelect.value as Layout); save(); });
zoomSelect.addEventListener('change', () => { reader?.setZoom(+zoomSelect.value); updateReadingHint(); save(); });
el('fit-page').addEventListener('click', () => { reader?.fit(); zoomSelect.value = '1'; updateReadingHint(); save(); });
el('fullscreen').addEventListener('click', async () => {
 try {
  if (document.fullscreenElement) await document.exitFullscreen();
  else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
  else showError('当前浏览器不支持全屏，可以使用浏览器的全屏或横屏阅读。');
 } catch { showError('暂时无法进入全屏，请使用浏览器的全屏功能。'); }
});

// 缩略图只排队可见项，最多两个任务；滚出视口立即释放像素。
let thumbObserver: IntersectionObserver | null = null;
let thumbGeneration = 0;
let thumbRunning = 0;
const thumbVisible = new Set<HTMLElement>();
const thumbReady = new Set<HTMLElement>();
const thumbQueue = new Set<HTMLElement>();
async function pumpThumbnails() {
 if (!reader || thumbRunning >= 2 || !thumbQueue.size) return;
 const button = thumbQueue.values().next().value!;
 thumbQueue.delete(button);
 if (!thumbVisible.has(button)) { void pumpThumbnails(); return; }
 const canvas = button.querySelector('canvas')!;
 const active = reader, generation = thumbGeneration;
 thumbRunning++;
 try {
  await active.renderThumbnail(+button.dataset.page!, canvas);
  if (generation === thumbGeneration && thumbVisible.has(button)) thumbReady.add(button);
  else { canvas.width = 0; canvas.height = 0; }
 } catch { canvas.width = 0; canvas.height = 0; }
 finally { thumbRunning--; void pumpThumbnails(); }
 void pumpThumbnails();
}
function closeThumbnails() {
 ++thumbGeneration; thumbObserver?.disconnect(); thumbObserver = null;
 thumbVisible.clear(); thumbReady.clear(); thumbQueue.clear();
 el('thumbnail-scroll').querySelectorAll('canvas').forEach((c) => { c.width = 0; c.height = 0; });
 el('thumbnail-scroll').replaceChildren();
 el('thumbnails').hidden = true; el('thumbnails-toggle').setAttribute('aria-expanded', 'false');
}
function openThumbnails() {
 if (!reader || loading) return;
 el('thumbnails').hidden = false; el('thumbnails-toggle').setAttribute('aria-expanded', 'true');
 const list = el('thumbnail-scroll');
 thumbObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
   const button = entry.target as HTMLElement;
   if (entry.isIntersecting) { thumbVisible.add(button); if (!thumbReady.has(button)) thumbQueue.add(button); }
   else {
    thumbVisible.delete(button); thumbReady.delete(button); thumbQueue.delete(button);
    const canvas = button.querySelector('canvas')!; canvas.width = 0; canvas.height = 0;
   }
  }
  void pumpThumbnails(); void pumpThumbnails();
 }, { root: list, rootMargin: '100px' });
 const fragment = document.createDocumentFragment();
 for (let page = 1; page <= totalPages; page++) {
  const button = document.createElement('button');
  button.className = 'thumbnail'; button.dataset.page = String(page); button.dataset.testid = `thumbnail-${page}`;
  button.setAttribute('aria-label', `跳转至第 ${page} 页`); button.setAttribute('aria-current', String(page === currentPage));
  const canvas = document.createElement('canvas'); canvas.width = 0; canvas.height = 0;
  const label = document.createElement('span'); label.textContent = String(page);
  button.append(canvas, label);
  button.addEventListener('click', () => { reader?.goTo(page); if (window.innerWidth < 760) closeThumbnails(); });
  fragment.append(button);
 }
 list.append(fragment);
 list.querySelectorAll<HTMLElement>('.thumbnail').forEach((button) => thumbObserver!.observe(button));
 list.querySelector<HTMLElement>(`[data-page="${currentPage}"]`)?.scrollIntoView({ block: 'center' });
}
el('thumbnails-toggle').addEventListener('click', () => el('thumbnails').hidden ? openThumbnails() : closeThumbnails());
el('thumbnails-close').addEventListener('click', closeThumbnails);
function stopGesture() { gestureWanted = false; camera.stop(); el('gesture-panel').hidden = true; updateGestureButton(); }
el('gesture-toggle').addEventListener('click', async () => {
 if (gestureWanted) { stopGesture(); return; }
 if (!reader || loading) return;
 gestureWanted = true; updateGestureButton(); el('gesture-panel').hidden = false;
 await camera.start();
});
el('sensitivity').addEventListener('change', () => { sensitivity = el<HTMLSelectElement>('sensitivity').value as Sensitivity; camera.setSensitivity(sensitivity); save(); });
el('preview-toggle').addEventListener('click', () => {
 previewExpanded = !previewExpanded;
 el('preview-content').hidden = !previewExpanded;
 el('preview-toggle').setAttribute('aria-expanded', String(previewExpanded));
 el('preview-toggle').setAttribute('aria-label', previewExpanded ? '收起摄像头预览' : '展开摄像头预览');
 el('preview-toggle').innerHTML = icon(previewExpanded ? 'minus' : 'camera');
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { save(); if (gestureWanted) stopGesture(); } });
window.addEventListener('pagehide', () => { save(); camera.stop(); void reader?.destroy(); });

let dragDepth = 0;
document.addEventListener('dragenter', (event) => { if (!event.dataTransfer?.types.includes('Files')) return; event.preventDefault(); dragDepth++; el('drop-overlay').hidden = false; });
document.addEventListener('dragover', (event) => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
document.addEventListener('dragleave', (event) => { event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; el('drop-overlay').hidden = true; } });
document.addEventListener('drop', (event) => { event.preventDefault(); dragDepth = 0; el('drop-overlay').hidden = true; const file = event.dataTransfer?.files[0]; if (file) void openPdf(file); });
window.addEventListener('blur', () => { dragDepth = 0; el('drop-overlay').hidden = true; });

// 只读诊断用于本地验收；不包含 PDF 字节或摄像头画面。
Object.assign(window, { __readerDiagnostics: () => {
 const data = reader?.diagnostics;
 return data ? { ...data, total: data.totalPages, current: data.currentPage, thumbnailPixels: Array.from(document.querySelectorAll('canvas')).reduce((n, c) => n + c.width * c.height, 0) } : { cachedPages: 0, activeRenders: 0, totalPages: 0, currentPage: 0, total: 0, current: 0 };
} });
