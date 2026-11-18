// 문지기 — 허락된 로그인만 통과하는지 (구글 확인은 가짜로 대신해요)
import express from 'express';

const GOOD = { 'tok-me': 'me@gmail.com', 'tok-friend': 'Friend@Gmail.com', 'tok-stranger': 'x@gmail.com' };
let lookups = 0, googleDown = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (!String(url).includes('identitytoolkit')) return realFetch(url, opts);
  lookups++;
  if (googleDown) throw new Error('network');
  const { idToken } = JSON.parse(opts.body);
  if (idToken === 'tok-unverified')
    return new Response(JSON.stringify({ users: [{ email: 'me@gmail.com', emailVerified: false }] }));
  const email = GOOD[idToken];
  if (!email) return new Response(JSON.stringify({ error: { message: 'INVALID_ID_TOKEN' } }), { status: 400 });
  return new Response(JSON.stringify({ users: [{ email, emailVerified: true }] }));
};

process.env.FIREBASE_WEB_API_KEY = 'fake';
const { requireUser } = await import('../auth.js');

const app = express();
app.use('/api', requireUser, (req, res) => res.json({ ok: true, who: req.userEmail || null }));
const srv = app.listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const call = async tok => {
  const r = await realFetch(base + '/api/x', { method: 'POST', headers: tok ? { Authorization: 'Bearer ' + tok } : {} });
  return { s: r.status, b: await r.json() };
};

const R = []; const ok = (n, c, g) => R.push([n, !!c, g]);

process.env.ALLOWED_EMAILS = '';
let r = await call(null);
ok('목록이 비면 잠금 꺼짐 (지금처럼 누구나)', r.s === 200, r.s);

process.env.ALLOWED_EMAILS = 'me@gmail.com, friend@gmail.com';
r = await call(null);           ok('증명서 없으면 401', r.s === 401 && r.b.error === 'LOGIN_REQUIRED', r.s);
r = await call('tok-me');       ok('내 계정은 통과', r.s === 200 && r.b.who === 'me@gmail.com', JSON.stringify(r.b));
r = await call('tok-friend');   ok('친구는 대문자 섞여도 통과', r.s === 200, r.s);
r = await call('tok-stranger'); ok('목록에 없는 계정은 403', r.s === 403 && r.b.error === 'NOT_ALLOWED', r.s);
r = await call('tok-fake');     ok('가짜 증명서는 401', r.s === 401 && r.b.error === 'LOGIN_EXPIRED', r.s);
r = await call('tok-unverified'); ok('이메일 미인증이면 401', r.s === 401, r.s);

const before = lookups;
await call('tok-me'); await call('tok-me');
ok('한 번 확인한 증명서는 다시 안 물어봄', lookups === before, lookups - before);

googleDown = true;
r = await call('tok-new-while-down'); ok('구글이 안 되면 503', r.s === 503, r.s);
googleDown = false;

delete process.env.FIREBASE_WEB_API_KEY;
r = await call('tok-other'); ok('설정 빠지면 500 + 안내', r.s === 500 && r.b.error === 'AUTH_CONFIG', r.s);

srv.close();
for (const [n, c, g] of R) console.log((c ? '  ✓ ' : '  ✗ ') + n + (c ? '' : '  받음: ' + g));
console.log(R.every(a => a[1]) ? '\n전부 통과' : '\n실패 있음');
process.exit(R.every(a => a[1]) ? 0 : 1);
