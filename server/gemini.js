// ────────────────────────────────────────────────────────────
//  Gemini 공용 호출 헬퍼
//
//  ⚠️ 개인정보 가이드 (중요)
//  - 사용자의 이메일 / 이름 / 로그인 ID 등은 절대 프롬프트에 넣지 마세요.
//  - 습관 이름, 체크 기록, 기분/메모처럼 "누구인지 알 수 없는" 데이터만 전달하세요.
//  - 이 서버는 데이터를 저장하지 않습니다(무상태). 저장은 앱의 localStorage/Firestore가 담당합니다.
// ────────────────────────────────────────────────────────────
import { GoogleGenAI } from '@google/genai';

const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

let ai = null;
function getClient() {
  if (!process.env.GEMINI_API_KEY) {
    const e = new Error('GEMINI_API_KEY가 설정되지 않았습니다. server/.env 파일을 확인하세요.');
    e.noKey = true;
    throw e;
  }
  if (!ai) ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return ai;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 에러 메시지/상태코드를 한 덩어리 소문자 문자열로 만들어 검사에 씀
function errHaystack(err) {
  if (!err) return '';
  return `${err.status || ''} ${err.code || ''} ${err.message || ''}`.toLowerCase();
}
// 429 = 요청 한도 초과. 분당 한도면 1분, 하루 한도면 내일까지 안 풀려요.
// 몇 초 뒤 재시도해봐야 실패할 확률이 높고, 그 재시도마저 한도를 더 깎아먹어서
// 여기서는 재시도하지 않고 바로 사용자에게 알려줍니다.
export function isRateLimited(err) {
  return /429|rate limit|ratelimit|quota|resource_exhausted/.test(errHaystack(err));
}
// 503 = 서버가 잠깐 붐비는 상태. 이건 조금 기다렸다 다시 하면 대개 성공해서 재시도할 값어치가 있어요.
export function isOverloaded(err) {
  return /503|overloaded|unavailable/.test(errHaystack(err));
}

/**
 * Gemini를 호출합니다.
 * @param {string} systemPrompt - 역할/규칙 지시문
 * @param {string} userContent  - 실제 사용자 데이터(비식별)
 * @param {{json?: boolean}} opts - json:true 이면 JSON 파싱해서 반환
 * @returns {Promise<string|object>} json 모드면 파싱된 객체/배열, 아니면 문자열
 * @throws  rateLimit:true 가 붙은 에러(재시도 소진) 또는 일반 에러
 */
export async function callGemini(systemPrompt, userContent, opts = {}) {
  const json = !!opts.json;
  const config = {
    systemInstruction: systemPrompt,
    temperature: 0.7,
  };
  if (json) config.responseMimeType = 'application/json';

  const backoffs = [2000, 4000, 8000]; // 최대 3회 재시도
  let lastErr;

  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    try {
      const client = getClient();
      const res = await client.models.generateContent({
        model: MODEL,
        contents: userContent,
        config,
      });
      const text = (res && res.text ? res.text : '').trim();

      if (!json) return text;

      // JSON 모드: 파싱 시도, 실패하면 아래 catch에서 1회 재요청
      try {
        return JSON.parse(stripFences(text));
      } catch (parseErr) {
        // 한 번 더 기회를 주되, 파싱 실패도 재시도 루프에 태움
        lastErr = new Error('AI가 올바른 JSON을 반환하지 않았습니다.');
        if (attempt < backoffs.length) { await sleep(1000); continue; }
        throw lastErr;
      }
    } catch (err) {
      lastErr = err;
      if (err.noKey) throw err;                              // 키 없음은 재시도 무의미
      if (isRateLimited(err)) { err.rateLimit = true; throw err; }   // 한도 초과는 즉시 포기
      if (isOverloaded(err)) {
        if (attempt < backoffs.length) { await sleep(backoffs[attempt]); continue; }
        err.overloaded = true;                               // 재시도 다 써도 계속 붐빔
      }
      throw err;
    }
  }
  throw lastErr;
}

// ```json ... ``` 같은 코드펜스가 섞여 오면 제거
function stripFences(t) {
  return t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
}
