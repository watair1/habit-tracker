// AI 서버 깨우기 — 자던 서버를 먼저 깨우고 요청을 보내는지
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';

const APP = pathToFileURL(new URL('../index.html', import.meta.url).pathname).href;
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const b = await chromium.launch(LAUNCH);

// 서버를 흉내 냅니다. sleepMs 만큼은 자고 있다가 그 뒤로 깨어나요.
async function open({ wakeDelay = 0, hasKey = true, wakeFails = false } = {}) {
  const ctx = await b.newContext({ timezoneId: 'Asia/Seoul', viewport: { width: 412, height: 800 } });
  const calls = [];
  await ctx.route('**/*', async r => {
    const u = r.request().url(), m = r.request().method();
    if (u.startsWith('file:')) return r.continue();
    if (/chart\.js|lucide|pretendard|firebase|gstatic/.test(u))
      return r.fulfill({ status:200, contentType:'application/javascript',
        body:'window.Chart=function(){this.destroy=function(){}};window.lucide={createIcons(){}};' });

    if (/onrender\.com/.test(u)) {
      calls.push({ path: new URL(u).pathname, m, at: Date.now() });
      if (m === 'GET') {                                  // 깨우는 인사
        if (wakeFails) return r.abort();
        if (wakeDelay) await new Promise(res => setTimeout(res, wakeDelay));
        return r.fulfill({ status:200, contentType:'application/json',
          body: JSON.stringify({ ok:true, service:'habit-tracker-ai', hasKey }) });
      }
      return r.fulfill({ status:200, contentType:'application/json',   // 진짜 AI 요청
        body: JSON.stringify({ reply:'네, 안녕하세요', actions:[] }) });
    }
    return r.fulfill({ status:200, body:'' });
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(APP);
  await page.waitForFunction(() => typeof window.aiCall === 'function');
  return { page, ctx, calls, errs };
}

const R = [];
const yes = (n, cond, got) => R.push({ n, pass: !!cond, got: got ?? '' });
const ok  = (n, got, want) => R.push({ n, pass: JSON.stringify(got)===JSON.stringify(want), got, want });

// ── 인사를 먼저 보내고 그 다음에 진짜 요청 ───────────────
{
  const { page, ctx, calls, errs } = await open();
  const out = await page.evaluate(() => aiCall('/api/day-agent', { message:'안녕' }));
  yes('답을 받아옴', out && out.reply === '네, 안녕하세요', out && out.reply);
  ok('두 번 부름 (깨우기 + 진짜 요청)', calls.length, 2);
  ok('먼저 가벼운 인사(GET /)', [calls[0].m, calls[0].path], ['GET', '/']);
  ok('그 다음 진짜 요청(POST)', [calls[1].m, calls[1].path], ['POST', '/api/day-agent']);

  // 두 번째부터는 이미 깨어 있으니 인사를 또 안 보냄
  await page.evaluate(() => aiCall('/api/day-agent', { message:'또 안녕' }));
  ok('두 번째 요청엔 인사 생략', calls.filter(c => c.m === 'GET').length, 1);
  ok('진짜 요청은 두 번 나감', calls.filter(c => c.m === 'POST').length, 2);
  if (errs.length) R.push({ n:'pageerror', pass:false, got:errs.join(' | ') });
  await ctx.close();
}

// ── 서버가 늦게 깨어나도 기다려줌 ───────────────────────
{
  const { page, ctx, calls, errs } = await open({ wakeDelay: 2500 });
  const t0 = Date.now();
  const out = await page.evaluate(() => aiCall('/api/day-agent', { message:'안녕' }));
  const took = Date.now() - t0;
  yes('늦게 깨어나도 결국 답을 받음', out && out.reply, out && out.reply);
  yes('깨어날 때까지 기다림', took >= 2400, took + 'ms');
  ok('그래도 요청은 두 번뿐', calls.length, 2);

  // 기다리는 동안 "깨우는 중" 안내가 떠야 해요
  yes('안내 문구가 준비돼 있음', await page.evaluate(() => {
    showAiWakeHint();
    const el = $('ai-wake-hint');
    return el && /깨우는 중/.test(el.textContent);
  }));
  if (errs.length) R.push({ n:'느린 깨우기 pageerror', pass:false, got:errs.join(' | ') });
  await ctx.close();
}

// ── 서버에 키가 없으면 기다리라고 하면 안 됨 ────────────
{
  const { page, ctx, calls, errs } = await open({ hasKey: false });
  const msg = await page.evaluate(async () => {
    try { await aiCall('/api/day-agent', { message:'안녕' }); return null; }
    catch (e) { return e.message; }
  });
  yes('키가 없다고 알려줌', /키가 안 꽂혀/.test(msg || ''), msg);
  yes('GEMINI_API_KEY 를 짚어줌', /GEMINI_API_KEY/.test(msg || ''));
  ok('진짜 요청은 아예 안 보냄', calls.filter(c => c.m === 'POST').length, 0);
  if (errs.length) R.push({ n:'키없음 pageerror', pass:false, got:errs.join(' | ') });
  await ctx.close();
}

// ── 서버가 아예 안 뜰 때 ────────────────────────────────
{
  const { page, ctx, calls, errs } = await open({ wakeFails: true });
  const msg = await page.evaluate(async () => {
    try { await aiCall('/api/day-agent', { message:'안녕' }); return null; }
    catch (e) { return e.message; }
  });
  yes('연결 못 했다고 알려줌', /연결하지 못했어요/.test(msg || ''), msg);
  ok('진짜 요청은 아예 안 보냄', calls.filter(c => c.m === 'POST').length, 0);
  if (errs.length) R.push({ n:'서버없음 pageerror', pass:false, got:errs.join(' | ') });
  await ctx.close();
}

let bad = 0;
for (const r of R) {
  if (!r.pass) bad++;
  console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.n + (r.pass ? '' : `\n      받음: ${JSON.stringify(r.got)}  기대: ${JSON.stringify(r.want)}`));
}
console.log(bad ? `\n${bad}개 실패` : '\n전부 통과');
await b.close();
process.exit(bad ? 1 : 0);
