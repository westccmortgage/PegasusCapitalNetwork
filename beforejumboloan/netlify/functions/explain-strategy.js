/**
 * explain-strategy.js — Netlify Function — AI Strategy Explainer
 *
 * Turns the studio's structured scenario (derived from KW.strategySummary)
 * into a plain-English walkthrough using Claude. The browser sends a compact,
 * PII-free context object; the API key never leaves the server.
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY  (required) — without it the function returns 503 so the
 *                      UI can fall back to the built-in rule-based explanation.
 *   ANTHROPIC_MODEL    (optional) — defaults to claude-opus-4-8. Set to e.g.
 *                      claude-haiku-4-5 / claude-sonnet-4-6 to trade quality
 *                      for lower latency/cost.
 *
 * COMPLIANCE: this tool organizes a REVIEW PATH only. The model is instructed
 * to never quote rates/APRs/payments as fact, never imply approval, and to
 * stay fair-lending safe. It explains only the numbers it is given.
 */

import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';

const SYSTEM_PROMPT = `You are the AI Strategy Explainer for BeforeJumboLoan.com, a mortgage SCENARIO-ORGANIZATION tool.
You receive a compact JSON snapshot of one buyer's scenario and explain it in plain English.

This tool does NOT quote loans. It organizes a "review path" (Conforming, High-Balance Conforming, Jumbo, DSCR, VA, FHA, etc.) and shows educational math illustrations. Mirror that careful framing.

Voice: warm, clear, and confident — a knowledgeable mortgage strategist talking to a smart buyer. No hype.

Hard rules:
- Explain ONLY the numbers present in the snapshot. Never invent figures, rates, or facts.
- Never state rates, payments, APRs, or DSCR thresholds as guarantees. Use "estimated", "illustration", "may". These are NOT quotes, approvals, or commitments to lend.
- Be fair-lending safe: never mention race, color, religion, national origin, sex, familial status, age, or disability.
- Lead with the single most useful takeaway (usually the review path and the before-jumbo "what-if").
- If whatIfBeforeJumbo.state is "over", explain the additional down payment that could bring the loan to the high-balance reference limit — framed as an illustration, noting jumbo may still be the right path for some buyers.
- If a DSCR ratio is present, explain what it suggests for an investment review (without stating a hard cutoff).
- If a buydown break-even is present, frame it as "may make sense if you keep the loan past ~N months".
- Mention 1-2 relevant attention items if present.
- 140-190 words. Short paragraphs or tight bullets. End by inviting them to send the scenario for review by a licensed mortgage professional.
- Respond with ONLY the explanation. No headers, no restating the JSON, no preamble.`;

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, message: 'Method not allowed' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return json(503, { ok: false, message: 'AI explainer not configured (missing ANTHROPIC_API_KEY).' });
  }

  let context;
  try {
    ({ context } = JSON.parse(event.body || '{}'));
  } catch {
    return json(400, { ok: false, message: 'Invalid JSON' });
  }
  if (!context || typeof context !== 'object') {
    return json(422, { ok: false, message: 'Missing scenario context.' });
  }

  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      thinking: { type: 'adaptive' }, // model self-moderates depth for a simple task
      output_config: { effort: 'low' }, // latency-sensitive; the user is waiting
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: 'Explain this mortgage scenario:\n\n' + JSON.stringify(context, null, 2),
        },
      ],
    });

    // Safety classifiers can decline (HTTP 200, stop_reason "refusal").
    if (message.stop_reason === 'refusal') {
      return json(422, { ok: false, message: 'This scenario could not be explained automatically.' });
    }

    const explanation = message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (!explanation) {
      return json(502, { ok: false, message: 'The explainer returned no text.' });
    }

    return json(200, { ok: true, model: MODEL, explanation });
  } catch (err) {
    const status = err && err.status;
    console.error('explain-strategy error:', status, err && err.message);
    if (status === 429) {
      return json(429, { ok: false, message: 'The explainer is busy. Try again in a moment.' });
    }
    if (status === 401 || status === 403) {
      return json(503, { ok: false, message: 'AI explainer credentials are invalid or unauthorized.' });
    }
    return json(502, { ok: false, message: 'The AI explainer is temporarily unavailable.' });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
