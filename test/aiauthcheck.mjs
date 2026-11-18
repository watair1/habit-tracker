// AI 를 부를 때 로그인 증명서를 붙이는지
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';

const APP = pathToFileURL(new URL('../index.html', import.meta.url).pathname).href;
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const b = await chromium.launch(LAUNCH);

// loggedIn: 가짜 Firebase 가 로그인한 사용자를 돌려줄지. serverSays: 서버가 돌려줄 응답
async function open({ loggedIn, authDelay = 0, serverSays = null }) {
  const ctx = await b.newContext({ timezoneId: 'Asia/Seoul', viewport: { width: 412, height: 800 } });
  const seen = [];
  await ctx.route('**/*', async r => {
    const u = r.request().url(), m = r.request().method();
    if (u.startsWith('file:')) return r.continue();
    if (/firebase-app/.test(u)) return r.fulfill({ status:200, contentType:'application/javascript', body:`
      window.firebase = {
        apps: [], initializeApp(){ this.apps.push(1); },
        auth(){ return {
          onAuthStateChanged(cb){ setTimeout(() => cb(${loggedIn ? `{
            uid:'u1', displayName:'테스트', photoURL:'', getIdToken: async () => 'TOKEN-123' }` : 'null'}), ${authDelay}); },
          getRedirectResult(){ return Promise.resolve(); } }; },
        firestore(){ return { collection(){ return { doc(){ return { collection(){ return {
          get: async () => ({ forEach(){} }), doc(){ return { get: async () => ({ exists:false }), set: async () => {} }; } }; } }; } }; } }; }
      };` });
    if (/firebase-(auth|firestore)/.test(u)) return r.fulfill({ status:200, contentType:'application/javascript', body:'' });
    if (/chart\.js|lucide|pretendard|gstatic/.test(u))
      return r.fulfill({ status:200, contentType:'application/javascript',
        body:'window.Chart=function(){this.destroy=function(){}};window.lucide={createIcons(){}};' });
    if (/onrender\.com/.test(u)) {
      if (m === 'GET') return r.fulfill({ status:200, contentType:'application/json',
        body: JSON.stringify({ ok:true, hasKey:true }) });
      seen.push(r.request().headers()['authorization'] || null);
      if (serverSays) return r.fulfill({ status: serverSays.status, contentType:'application/json', body: JSON.stringify(serverSays.body) });
      return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ reply:'네' }) });
    }
    return r.fulfill({ status:200, body:'' });
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(APP);
  await page.waitForFunction(() => typeof window.aiCall === 'function');
  return { page, ctx, seen, errs };
}
const ask = page => page.evaluate(async () => {
  try { return { ok: await aiCall('/api/day-agent', { message:'안녕' }) }; }
  catch (e) { return { err: e.message }; }
});

const R = [];
const yes = (n, c, g) => R.push({ n, pass: !!c, got: g ?? '' });

{
  const { page, ctx, seen, errs } = await open({ loggedIn: true });
  const r = await ask(page);
  yes('로그인했으면 답을 받음', r.ok && r.ok.reply === '네', JSON.stringify(r));
  yes('증명서를 붙여 보냄', seen[0] === 'Bearer TOKEN-123', seen[0]);
  if (errs.length) R.push({ n:'pageerror', pass:false, got:errs.join(' | ') });
  await ctx.close();
}
{
  // 앱을 켜자마자 AI 를 눌러서 로그인 확인이 아직 안 끝난 경우 — 기다렸다 붙여야 해요
  const { page, ctx, seen } = await open({ loggedIn: true, authDelay: 1500 });
  await ask(page);
  yes('로그인 확인이 늦어도 기다렸다 붙임', seen[0] === 'Bearer TOKEN-123', seen[0]);
  await ctx.close();
}
{
  const { page, ctx, seen } = await open({ loggedIn: false,
    serverSays: { status: 401, body: { error:'LOGIN_REQUIRED', message:'AI 는 로그인해야 쓸 수 있어요. 오른쪽 위 로그인을 눌러주세요.' } } });
  const r = await ask(page);
  yes('로그인 안 했으면 증명서 없이 보냄', seen[0] === null, seen[0]);
  yes('서버가 막으면 로그인하라고 알려줌', /로그인해야/.test(r.err || ''), r.err);
  await ctx.close();
}
{
  const { page, ctx } = await open({ loggedIn: true,
    serverSays: { status: 403, body: { error:'NOT_ALLOWED', message:'이 계정은 AI 를 쓸 수 없어요.' } } });
  const r = await ask(page);
  yes('허락 안 된 계정이면 그렇게 알려줌', /쓸 수 없어요/.test(r.err || ''), r.err);
  await ctx.close();
}

let bad = 0;
for (const r of R) { if (!r.pass) bad++; console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.n + (r.pass ? '' : `\n      받음: ${JSON.stringify(r.got)}`)); }
console.log(bad ? `\n${bad}개 실패` : '\n전부 통과');
await b.close();
process.exit(bad ? 1 : 0);
