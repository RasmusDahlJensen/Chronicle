import { BroadcastChannel } from 'node:worker_threads';

let warmed = false;

/** Test-only CPU workload; this is deliberately not a Chronicle simulation. */
export default function computeControlled(): string {
  if (!warmed) {
    warmed = true;
    return 'warm';
  }
  const channel = new BroadcastChannel(`chronicle-compute-test-${process.pid}`);
  channel.postMessage('started');
  channel.close();
  const until = performance.now() + 350;
  while (performance.now() < until) { /* Consume actual worker CPU. */ }
  return 'computed';
}
