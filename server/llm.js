// ────────────────────────────────────────────────────────────
//  어느 AI 를 쓸지 고르는 곳
//
//  AI_PROVIDER=claude  → Claude (claude.js)
//  그 외 / 비어 있음    → Gemini (gemini.js, 지금까지 쓰던 것)
//
//  Claude 는 쓰는 만큼 돈이 나가요. 그래서 로그인 잠금(ALLOWED_EMAILS)이
//  비어 있으면 Claude 를 아예 부르지 않아요. 아무나 내 돈으로 쓰는 걸 막으려고요.
// ────────────────────────────────────────────────────────────
import { callGemini } from './gemini.js';
import { callClaude, CLAUDE_MODEL } from './claude.js';
import { allowedEmails } from './auth.js';

export const provider = () => (process.env.AI_PROVIDER || 'gemini').trim().toLowerCase();

export function modelLabel() {
  return provider() === 'claude' ? `claude (${CLAUDE_MODEL})` : `gemini (${process.env.GEMINI_MODEL || 'gemini-flash-latest'})`;
}

export function hasKey() {
  return provider() === 'claude' ? !!process.env.ANTHROPIC_API_KEY : !!process.env.GEMINI_API_KEY;
}

export async function callAI(systemPrompt, userContent, opts = {}) {
  const useClaude = provider() === 'claude';
  if (useClaude && !allowedEmails().length) {
    const e = new Error('ALLOWED_EMAILS 가 비어 있어서 Claude 를 부르지 않았어요.');
    e.locked = true;
    throw e;
  }
  const t0 = Date.now();
  try {
    return await (useClaude ? callClaude : callGemini)(systemPrompt, userContent, opts);
  } finally {
    // 오래 걸리는 원인을 찾을 수 있게, 한 번 부를 때마다 몇 초 걸렸는지 남겨요.
    console.log(`[AI] ${useClaude ? 'claude' : 'gemini'} ${((Date.now() - t0) / 1000).toFixed(1)}초`);
  }
}
