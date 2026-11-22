// ────────────────────────────────────────────────────────────
//  Claude 공용 호출 헬퍼 (gemini.js 와 같은 모양으로 씁니다)
//
//  ⚠️ 개인정보 가이드는 gemini.js 와 같아요.
//  - 이메일 / 이름 / 로그인 ID 는 절대 프롬프트에 넣지 않아요.
//
//  환경변수
//    ANTHROPIC_API_KEY  Anthropic 콘솔에서 만든 키. 코드에 박지 말고 Render 에만 넣어요.
//    AI_CLAUDE_MODEL    기본 claude-sonnet-5-5
//    AI_CLAUDE_EFFORT   생각을 얼마나 깊게 할지. low | medium | high (기본 low)
//                       비서 대화는 빨라야 해서 low 로 시작해요. 답이 얕으면 medium 으로.
// ────────────────────────────────────────────────────────────
import Anthropic from '@anthropic-ai/sdk';

export const CLAUDE_MODEL = process.env.AI_CLAUDE_MODEL || 'claude-sonnet-5-5';
const EFFORT = process.env.AI_CLAUDE_EFFORT || 'low';

let client = null;
function getClient() {
  if (client) return client;
  if (!process.env.ANTHROPIC_API_KEY) {
    const e = new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.');
    e.noKey = true;
    throw e;
  }
  // 앱은 90초까지 기다려요. 그 안에 끝나도록 한 번만 다시 시도하고 60초에서 끊어요.
  client = new Anthropic({ timeout: 60_000, maxRetries: 1 });
  return client;
}
// 테스트에서 가짜 클라이언트를 끼워 넣을 때만 써요.
export function _setClientForTest(c) { client = c; }

/**
 * Claude 를 호출합니다. callGemini 와 똑같이 쓰면 돼요.
 * @param {string} systemPrompt
 * @param {string} userContent
 * @param {{json?: boolean}} opts - json:true 면 JSON 으로 파싱해서 돌려줘요
 */
export async function callClaude(systemPrompt, userContent, opts = {}) {
  const json = !!opts.json;
  const system = json
    ? `${systemPrompt}\n\n응답은 JSON 하나만 보내라. 코드펜스(\`\`\`)나 설명 문장 없이.`
    : systemPrompt;

  // JSON 이 깨져서 오면 한 번만 다시 물어봐요.
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await getClient().beta.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 16000,
        system,
        messages: [{ role: 'user', content: userContent }],
        output_config: { effort: opts.effort || EFFORT },
        // 안전 문제로 답을 거절하면 Anthropic 서버가 알아서 다른 모델로 대신 답하게 해요.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
    } catch (err) {
      throw markError(err);
    }

    if (res.stop_reason === 'refusal') {
      const e = new Error('Claude 가 이 요청에는 답하지 않았어요.');
      e.refusal = true;
      throw e;
    }

    const text = (res.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    if (!json) return text;
    try {
      return parseJson(text);
    } catch {
      if (attempt === 0) continue;
      throw new Error('AI가 올바른 JSON을 반환하지 않았습니다.');
    }
  }
}

// SDK 에러를 routes/ai.js 가 알아듣는 표시(noKey / rateLimit / overloaded)로 바꿔요.
function markError(err) {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    console.error('[claude] 키가 틀렸거나 권한이 없어요:', err.message);
    err.noKey = true;
  } else if (err instanceof Anthropic.RateLimitError) {
    err.rateLimit = true;
  } else if (err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
    // 5xx(붐빔 529 포함), 연결 끊김, 시간 초과
    err.overloaded = true;
  }
  return err;
}

// 코드펜스나 앞뒤 말이 섞여 와도 가장 바깥 { } 또는 [ ] 만 골라 읽어요.
function parseJson(t) {
  const s = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(s); } catch {}
  const i = s.search(/[[{]/), j = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (i >= 0 && j > i) return JSON.parse(s.slice(i, j + 1));
  throw new Error('no json');
}
