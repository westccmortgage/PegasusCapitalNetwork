/* Offline tests for the explain-strategy Netlify Function's guard logic.
 * The live model call can't run without ANTHROPIC_API_KEY, but every
 * validation / error path is deterministic and tested here. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../netlify/functions/explain-strategy.js';

const post = (body) => ({ httpMethod: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

test('returns 503 when ANTHROPIC_API_KEY is absent', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const res = await handler(post({ context: { market: 'X' } }));
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).ok, false);
});

test('rejects non-POST with 405', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test-dummy';
  const res = await handler({ httpMethod: 'GET' });
  assert.equal(res.statusCode, 405);
});

test('rejects invalid JSON with 400', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test-dummy';
  const res = await handler(post('{not json'));
  assert.equal(res.statusCode, 400);
});

test('rejects missing context with 422', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test-dummy';
  const res = await handler(post({}));
  assert.equal(res.statusCode, 422);
});

test('always returns JSON content-type', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const res = await handler(post({ context: {} }));
  assert.equal(res.headers['Content-Type'], 'application/json');
});
