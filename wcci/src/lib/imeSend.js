// Pure decision: should an Enter keydown submit the chat composer?
//
// Chinese (and Japanese/Korean) input methods use Enter to CONFIRM a candidate
// mid-composition. Sending then would submit half-typed pinyin. We must send
// only when Enter is a real submit — not part of IME composition.
//
// Kept framework-free and side-effect-free so it is unit-testable without a DOM.
export function shouldSendOnEnter(e, composing) {
  if (!e || e.key !== 'Enter') return false;
  if (e.shiftKey) return false;
  if (composing) return false;                       // our own compositionstart flag
  const ne = e.nativeEvent || e;
  if (ne && ne.isComposing) return false;            // browser-reported IME composition
  const kc = (e.keyCode != null ? e.keyCode : (ne && ne.keyCode));
  if (kc === 229) return false;                      // 229 = IME is still processing the key
  return true;
}
