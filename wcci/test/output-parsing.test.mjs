// Structured-output parsing (Phase 7) — the balanced-brace extractor must:
//  • parse CONVO_META even though it nests state:{...} and resources:[{...}]
//  • never leak ANY machine line into the visible chat bubble
//  • keep the thank-you text that follows SCENARIO_COMPLETE
// This mirrors extractMarker() in src/App.jsx (kept identical by test intent).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Load the exact extractMarker implementation from App.jsx so the test tracks
// the real code (fails loudly if the function is renamed/removed).
const appSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'App.jsx'), 'utf8');
const fnMatch = appSrc.match(/function extractMarker[\s\S]*?\n}\n/);
assert.ok(fnMatch, 'extractMarker must exist in App.jsx');
// eslint-disable-next-line no-eval
const extractMarker = eval('(' + fnMatch[0].replace(/^function extractMarker/, 'function') + ')');

test('CONVO_META with nested braces parses and strips cleanly', () => {
  const reply =
    'That makes sense — the company behind this is West Coast Capital Mortgage Inc.\n' +
    'You do not need to share any contact info to review this.\n' +
    'CONVO_META:{"resources":[{"id":"suncoast-about","reason":"Florida team"},{"id":"wccm-about","reason":"Verify"}],"state":{"stage":"trust_building","objections":["identity","privacy"],"contactConsent":"declined"},"handoff":"none"}\n' +
    'PROFILE_UPDATE:{"state":"FL","zipOrCounty":"Boca Raton","loanPurpose":"purchase"}';
  const cm = extractMarker(reply, 'CONVO_META');
  assert.ok(cm.obj, 'nested JSON parses');
  assert.deepEqual(cm.obj.resources.map(r => r.id), ['suncoast-about', 'wccm-about']);
  assert.equal(cm.obj.state.contactConsent, 'declined');
  const pu = extractMarker(cm.cleaned, 'PROFILE_UPDATE');
  assert.equal(pu.obj.state, 'FL');
  assert.ok(!/CONVO_META|PROFILE_UPDATE|[{}]/.test(pu.cleaned), 'no machine residue leaks to the bubble');
  assert.ok(pu.cleaned.includes('West Coast Capital Mortgage Inc.'), 'prose preserved');
});

test('pretty-printed / multiline CONVO_META parses fully and never leaks (regression)', () => {
  // The regex approach stopped at the first inner "}" on a multiline object,
  // dropping resources + state patch and leaking the JSON tail. Balanced-brace
  // scanning must handle standard LLM pretty-printing.
  const reply =
    'Here is your answer about licensing.\n' +
    'CONVO_META:{\n' +
    '  "resources": [\n' +
    '    { "id": "suncoast-about", "reason": "FL team" }\n' +
    '  ],\n' +
    '  "state": { "stage": "trust_building", "contactConsent": "declined" },\n' +
    '  "handoff": "none"\n' +
    '}';
  const cm = extractMarker(reply, 'CONVO_META');
  assert.ok(cm.obj, 'multiline JSON parses');
  assert.equal(cm.obj.state.contactConsent, 'declined', 'state patch not dropped');
  assert.deepEqual(cm.obj.resources.map(r => r.id), ['suncoast-about']);
  assert.ok(!/CONVO_META|[{}]|handoff|contactConsent/.test(cm.cleaned), 'no JSON tail leaks');
  assert.equal(cm.cleaned, 'Here is your answer about licensing.');
});

test('trailing prose after CONVO_META JSON is preserved, marker stripped (regression)', () => {
  const cm = extractMarker('Sure.\nCONVO_META:{"resources":[],"handoff":"none"} hope that helps!', 'CONVO_META');
  assert.ok(cm.obj, 'parses with trailing prose');
  assert.ok(!/CONVO_META|[{}]/.test(cm.cleaned), 'marker + braces removed');
  assert.ok(cm.cleaned.includes('hope that helps!'), 'trailing prose kept');
});

test('invalid/truncated CONVO_META is still fully stripped (never leaks)', () => {
  const reply = 'Here is your answer.\nCONVO_META:{"resources":[{"id":"x" BROKEN';
  const cm = extractMarker(reply, 'CONVO_META');
  assert.equal(cm.obj, null, 'invalid JSON → null, not a throw');
  assert.ok(!/CONVO_META|[{}]/.test(cm.cleaned), 'truncated marker fully removed');
  assert.equal(cm.cleaned, 'Here is your answer.');
});

test('SCENARIO_COMPLETE keeps the following thank-you text', () => {
  const reply =
    'Great, I have everything.\n' +
    'SCENARIO_COMPLETE:{"name":"Ana","phone":"305-555-0100","loanPurpose":"purchase"}\n' +
    'Thank you! Our team will reach out shortly.';
  const sc = extractMarker(reply, 'SCENARIO_COMPLETE');
  assert.equal(sc.obj.name, 'Ana');
  assert.ok(sc.cleaned.includes('Thank you! Our team will reach out shortly.'));
  assert.ok(!/SCENARIO_COMPLETE|[{}]/.test(sc.cleaned));
});

test('no marker present → returns null (prose untouched)', () => {
  assert.equal(extractMarker('just a normal message', 'CONVO_META'), null);
});
