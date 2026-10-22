import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

let model: HandLandmarker | null = null;
const workerScope = self as unknown as DedicatedWorkerGlobalScope;
workerScope.onmessage = async (event: MessageEvent) => {
  const message = event.data;
  if (message.type === 'init') {
    try {
      const files = await FilesetResolver.forVisionTasks(message.wasmPath);
      model = await HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: message.modelPath, delegate: 'CPU' },
        runningMode: 'VIDEO', numHands: 1,
        minHandDetectionConfidence: 0.7, minHandPresenceConfidence: 0.7, minTrackingConfidence: 0.7,
      });
      workerScope.postMessage({ type: 'ready' });
    } catch (error) {
      workerScope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  } else if (message.type === 'frame') {
    const bitmap = message.bitmap as ImageBitmap;
    try {
      if (!model) throw new Error('手部模型尚未就绪');
      const result = model.detectForVideo(bitmap, message.time);
      workerScope.postMessage({ type: 'result', time: message.time,
        landmarks: result.landmarks[0] ?? null,
        confidence: result.handedness[0]?.[0]?.score ?? 0 });
    } catch (error) {
      workerScope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally { bitmap.close(); }
  } else if (message.type === 'dispose') { model?.close(); model = null; }
};
