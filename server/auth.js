// ────────────────────────────────────────────────────────────
//  로그인한 허락된 사람만 AI 를 쓰게 막는 문지기
//
//  서버 주소는 공개된 index.html 에 적혀 있어요. CORS 는 "다른 웹사이트"가
//  부르는 것만 막을 뿐이라, 주소를 아는 사람이 프로그램으로 직접 부르면
//  그대로 통과합니다. 무료 Gemini 일 땐 한도만 깎였지만, 돈이 드는 AI 로
//  바꾸면 남이 쓴 만큼 돈이 나가요.
//
//  그래서 앱이 구글 로그인(Firebase) 증명서(ID 토큰)를 같이 보내고,
//  서버는 그게 진짜인지 구글에 물어본 뒤 ALLOWED_EMAILS 에 적힌 사람만
//  통과시킵니다. 증명서는 구글이 서명한 거라 위조할 수 없어요.
//
//  환경변수
//    ALLOWED_EMAILS        쓸 수 있는 구글 계정 이메일 (쉼표로 구분). 비우면 잠금 꺼짐.
//    FIREBASE_WEB_API_KEY  index.html 의 FIREBASE_CONFIG.apiKey 와 같은 값.
//                          증명서를 확인할 때 "어느 프로젝트의 로그인인지" 알려주는 용도예요.
// ────────────────────────────────────────────────────────────

const LOOKUP_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup';
const CACHE_MS = 30 * 60 * 1000;      // 증명서는 1시간짜리. 한 번 확인한 건 30분 동안 다시 안 물어봐요.

export function allowedEmails() {
  return (process.env.ALLOWED_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

const verified = new Map();           // 증명서 → { email, until }

// 구글에 "이 증명서 진짜야? 누구 거야?" 를 물어봐요. 가짜·만료면 null.
async function lookupEmail(idToken) {
  const hit = verified.get(idToken);
  if (hit && hit.until > Date.now()) return hit.email;

  const key = process.env.FIREBASE_WEB_API_KEY;
  if (!key) { const e = new Error('FIREBASE_WEB_API_KEY 없음'); e.config = true; throw e; }

  const res = await fetch(`${LOOKUP_URL}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) return null;           // INVALID_ID_TOKEN, TOKEN_EXPIRED 등
  const data = await res.json().catch(() => ({}));
  const u = data.users && data.users[0];
  // 이메일 인증이 안 된 계정은 받지 않아요. 남의 이메일로 가입만 해둔 경우를 막으려고요.
  if (!u || !u.email || u.emailVerified === false) return null;

  const email = u.email.toLowerCase();
  if (verified.size > 500) verified.clear();     // 메모리 무한 증가 방지
  verified.set(idToken, { email, until: Date.now() + CACHE_MS });
  return email;
}

export async function requireUser(req, res, next) {
  const allowed = allowedEmails();
  if (!allowed.length) return next();            // 잠금 꺼짐 (ALLOWED_EMAILS 를 아직 안 넣음)

  const m = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
  if (!m) {
    return res.status(401).json({ error: 'LOGIN_REQUIRED',
      message: 'AI 는 로그인해야 쓸 수 있어요. 오른쪽 위 로그인을 눌러주세요.' });
  }

  let email;
  try { email = await lookupEmail(m[1]); }
  catch (err) {
    if (err.config) {
      console.error('[auth] FIREBASE_WEB_API_KEY 가 비어 있어요. Render 환경변수에 넣어주세요.');
      return res.status(500).json({ error: 'AUTH_CONFIG',
        message: '서버 로그인 확인 설정이 빠져 있어요. FIREBASE_WEB_API_KEY 를 확인해주세요.' });
    }
    console.error('[auth] 구글 확인 실패:', err.message);
    return res.status(503).json({ error: 'AUTH_UNAVAILABLE',
      message: '로그인 확인이 잠깐 안 돼요. 조금 뒤에 다시 시도해주세요.' });
  }

  if (!email) {
    return res.status(401).json({ error: 'LOGIN_EXPIRED',
      message: '로그인이 만료됐어요. 로그아웃했다가 다시 로그인해주세요.' });
  }
  if (!allowed.includes(email)) {
    return res.status(403).json({ error: 'NOT_ALLOWED',
      message: '이 계정은 AI 를 쓸 수 없어요.' });
  }
  req.userEmail = email;
  next();
}
