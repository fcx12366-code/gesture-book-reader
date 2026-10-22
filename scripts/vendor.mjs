import { cp, mkdir, readFile, writeFile, access, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'public', 'vendor');
const exists = async (p) => access(p).then(() => true, () => false);
await mkdir(dest, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(path.join(root, 'node_modules/pdfjs-dist', dir), path.join(dest, 'pdfjs', dir), {
    recursive: true,
    // The reader renders static pages and never enables the PDF form scripting sandbox.
    filter: (source) => !/^quickjs-eval\.(js|wasm)$/.test(path.basename(source)),
  });
}
for (const file of ['quickjs-eval.js', 'quickjs-eval.wasm']) {
  const unused = path.join(dest, 'pdfjs/wasm', file);
  if (await exists(unused)) await unlink(unused);
}
await cp(path.join(root, 'node_modules/@mediapipe/tasks-vision/wasm'), path.join(dest, 'mediapipe/wasm'), { recursive: true });
const model = path.join(dest, 'mediapipe/hand_landmarker.task');
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
if (!(await exists(model))) {
  console.log('下载官方 Hand Landmarker 模型（仅安装时联网，阅读时使用本地文件）…');
  const response = await fetch(modelUrl, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`模型下载失败: HTTP ${response.status}。请重新运行 npm run vendor。`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 1000000) throw new Error('模型文件异常，未写入。');
  await writeFile(model, buffer);
}
await mkdir(path.join(root, 'public/licenses'), { recursive: true });
for (const pkg of ['pdfjs-dist', 'page-flip', '@mediapipe/tasks-vision']) {
  const location = path.join(root, 'node_modules', pkg);
  const info = JSON.parse(await readFile(path.join(location, 'package.json'), 'utf8'));
  for (const filename of ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'NOTICE']) {
    if (await exists(path.join(location, filename))) {
      await cp(path.join(location, filename), path.join(root, 'public/licenses', `${pkg.replaceAll('/', '-')}-${filename}`));
    }
  }
  console.log(`${pkg} ${info.version} · ${info.license}`);
}
const hash = createHash('sha256').update(await readFile(model)).digest('hex');
if (hash !== 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1') {
  throw new Error('本地手势模型 SHA-256 与固定官方版本不匹配，请检查模型文件。');
}
await writeFile(path.join(dest, 'model-info.json'), JSON.stringify({ source: modelUrl, sha256: hash }, null, 2));
console.log('本地 PDF 字体、CMap、WASM、手势模型与许可已准备好。');
