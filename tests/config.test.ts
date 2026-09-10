import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readBackendConfig } from '../server/config.ts';

test('backend configuration has finite defaults and rejects unsafe or ambiguous limits', () => {
  const defaults = readBackendConfig({});
  assert.ok(defaults.workers >= 1 && defaults.workers <= 2);
  assert.equal(defaults.maxQueue, 4);
  assert.equal(defaults.jobTimeoutMs, 20_000);
  for (const [key, value] of [
    ['CHRONICLE_WORKERS', '0'], ['CHRONICLE_WORKERS', '9'],
    ['CHRONICLE_QUEUE_LIMIT', '-1'], ['CHRONICLE_QUEUE_LIMIT', '33'],
    ['CHRONICLE_JOB_TIMEOUT_MS', '25001'], ['CHRONICLE_WORKERS', '2.5'],
    ['CHRONICLE_WORKERS', ''], ['CHRONICLE_WORKERS', '2e0'],
    ['CHRONICLE_LOG_LEVEL', 'verbose'],
  ]) assert.throws(() => readBackendConfig({ [key]: value }), new RegExp(key));
  assert.equal(readBackendConfig({ CHRONICLE_JOB_TIMEOUT_MS: '25000' }).jobTimeoutMs, 25_000);
  assert.deepEqual(readBackendConfig({ CHRONICLE_WORKERS: '1', CHRONICLE_QUEUE_LIMIT: '0', CHRONICLE_LOG_LEVEL: 'silent' }), {
    ...defaults, workers: 1, maxQueue: 0, logLevel: 'silent',
  });
});
