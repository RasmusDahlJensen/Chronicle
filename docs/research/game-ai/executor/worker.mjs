import { Worker } from 'node:worker_threads';

await new Promise((resolve, reject) => {
  const worker = new Worker(new URL('./audit.mjs', import.meta.url));
  worker.once('error', reject);
  worker.once('exit', (code) => {
    if (code === 0) resolve();
    else reject(new Error(`Executor diagnostic worker exited ${code}`));
  });
});
