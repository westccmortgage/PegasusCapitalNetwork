// Chinese input understanding: the parser extracts scenario facts from natural
// Simplified Chinese, and conversation intelligence detects intent, geography,
// and privacy/contact hesitation while preserving the Chinese language.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseScenario } from '../src/lib/parser.js';
import { initialConversationState, updateStateFromUserMessage } from '../src/lib/conversationIntelligence.js';

test('extract: 佛罗里达 150万 purchase, 30万 down, self-employed', () => {
  const p = parseScenario('我想在佛罗里达买一套150万美元的房子，准备首付30万美元，我是自雇人士。');
  assert.equal(p.state, 'FL');
  assert.equal(p.loanPurpose, 'purchase');
  assert.equal(p.purchasePrice, 1500000);
  assert.equal(p.downPayment, 300000);
  assert.equal(p.employmentType, 'self-employed');
  assert.equal(p.loanAmount, 1200000);
});

test('extract: 加州 refinance to lower the monthly payment', () => {
  const p = parseScenario('我想在加州重新贷款，希望降低每月还款。');
  assert.equal(p.state, 'CA');
  assert.equal(p.loanPurpose, 'refinance');
  assert.equal(p.borrowerGoal, 'lowest payment');
});

test('extract: investment property, compare conventional vs DSCR', () => {
  const p = parseScenario('我准备购买投资房，想比较普通贷款和DSCR贷款。');
  assert.equal(p.loanPurpose, 'investment');
  assert.equal(p.occupancy, 'investment');
  assert.equal(p.incomeDocPath, 'DSCR');
  assert.equal(p.borrowerGoal, 'compare all');
});

test('intent + geography + income are detected together (no re-ask needed)', () => {
  let s = initialConversationState();
  const msg = '我想在佛罗里达买一套150万美元的房子，准备首付30万美元，我是自雇人士。';
  const profile = parseScenario(msg);
  s = updateStateFromUserMessage(s, msg, profile, 'zh-CN');
  assert.equal(s.language, 'zh-CN', 'Chinese language preserved');
  assert.equal(s.state, 'FL');
  assert.ok(s.topics.includes('purchase'));
  assert.ok(s.topics.includes('self_employed'));
});

test('contact hesitation in Chinese → sticky decline', () => {
  let s = initialConversationState();
  s = updateStateFromUserMessage(s, '我不想留下电话号码，只想先了解一下。', {}, 'zh-CN');
  assert.equal(s.contactConsent, 'declined');
  assert.ok(s.objections.includes('contact_hesitation'));
  // Sticky across a neutral next turn.
  s = updateStateFromUserMessage(s, '房价大概多少？', {}, 'zh-CN');
  assert.equal(s.contactConsent, 'declined');
});

test('identity + privacy questions in Chinese are detected', () => {
  let s = initialConversationState();
  s = updateStateFromUserMessage(s, '你们是谁？这是真的公司吗？正规吗？', {}, 'zh-CN');
  assert.ok(s.objections.includes('identity'));
  s = updateStateFromUserMessage(s, '我不想被很多公司打电话骚扰。', {}, 'zh-CN');
  assert.ok(s.objections.includes('privacy'));
  assert.equal(s.stage, 'trust_building');
});

test('human request in Chinese lifts a prior decline', () => {
  let s = initialConversationState();
  s = updateStateFromUserMessage(s, '不想留电话', {}, 'zh-CN');
  assert.equal(s.contactConsent, 'declined');
  s = updateStateFromUserMessage(s, '可以让专业人士打电话给我吗', {}, 'zh-CN');
  assert.equal(s.userRequestedHuman, true);
  assert.notEqual(s.contactConsent, 'declined');
});
