# 第三方组件说明

本应用包含下列第三方组件。安装后的实际包清单与许可由 `package-lock.json`、各包 `package.json` 以及许可原文确定。`npm run vendor` 将运行时所需文件及许可副本复制到应用静态资源目录；分发 `dist` 时须保留对应许可文件。

| 组件 | 固定版本 | 用途 | 许可 |
| --- | --- | --- | --- |
| `pdfjs-dist` | 6.4.299 | 本地 PDF 解析、渲染与 worker | Apache-2.0 |
| `page-flip` | 2.0.7 | 翻书动画 | MIT |
| `@mediapipe/tasks-vision` | 1.1.1 | 浏览器内手部关键点识别及 WASM | Apache-2.0 |

以上版本与许可已读取本机安装包的 `package.json` 核验。手部模型为 Google MediaPipe 官方 Hand Landmarker float16 第 1 版，安装脚本从 `storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task` 获取；来源 URL 与 SHA-256 记录于 `public/vendor/model-info.json`（构建后为 `dist/vendor/model-info.json`）。模型相关许可说明见 `public/licenses` 内随附文件。摄像头与 PDF 内容由应用在本地处理。

开发与测试组件包括 Vite 8.3.5（MIT）、TypeScript 7.0.2（Apache-2.0）、Playwright 1.64.1（Apache-2.0）、tsx 4.20.6（MIT）、pdf-lib 1.17.1（MIT）和 Node 类型声明 24.10.1（MIT）；不应把测试夹具或开发依赖复制到 `dist`。完整依赖树保留于锁文件。
