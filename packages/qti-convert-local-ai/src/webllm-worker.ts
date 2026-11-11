/**
 * Web Worker entry for running WebLLM off the main thread.
 *
 * Usage in an app (Vite/webpack):
 *
 *   // llm.worker.ts
 *   import '@citolab/qti-convert-local-ai/webllm-worker';
 *
 *   // app code
 *   llmSettings: {
 *     worker: () => new Worker(new URL('./llm.worker.ts', import.meta.url), { type: 'module' })
 *   }
 */
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (message: MessageEvent) => {
  handler.onmessage(message);
};
