// Mobile chat composer — IME composition safety. Pressing Enter while a Chinese
// (or Japanese/Korean) input method is composing must NOT submit the message.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldSendOnEnter } from '../src/lib/imeSend.js';

const key = (over = {}) => ({ key: 'Enter', shiftKey: false, keyCode: 13, nativeEvent: { isComposing: false, keyCode: 13 }, ...over });

test('plain Enter (not composing) sends', () => {
  assert.equal(shouldSendOnEnter(key(), false), true);
});

test('Shift+Enter never sends (newline)', () => {
  assert.equal(shouldSendOnEnter(key({ shiftKey: true }), false), false);
});

test('Enter during our composition flag does NOT send', () => {
  assert.equal(shouldSendOnEnter(key(), true), false);
});

test('Enter with nativeEvent.isComposing does NOT send', () => {
  assert.equal(shouldSendOnEnter(key({ nativeEvent: { isComposing: true } }), false), false);
});

test('Enter with keyCode 229 (IME processing) does NOT send', () => {
  assert.equal(shouldSendOnEnter(key({ keyCode: 229, nativeEvent: { isComposing: false, keyCode: 229 } }), false), false);
});

test('non-Enter keys never send', () => {
  assert.equal(shouldSendOnEnter(key({ key: 'a', keyCode: 65 }), false), false);
});

test('composition end then Enter sends (real submit after confirming candidate)', () => {
  // Simulate: compositionend cleared the flag; a fresh Enter with isComposing:false.
  assert.equal(shouldSendOnEnter(key(), false), true);
});
