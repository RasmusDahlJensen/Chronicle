let calls = 0;

/** First call warms the worker; the first real request fails deliberately. */
export default function computeFailsOnce(): string {
  if (++calls === 2) throw new Error('Deliberate task failure');
  return 'recovered';
}
