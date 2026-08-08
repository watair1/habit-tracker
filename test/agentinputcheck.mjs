// AI 비서 입력칸 — 여러 줄이 되는지, Enter 동작이 기기별로 맞는지
import { chromium, devices } from 'playwright';
import { pathToFileURL } from 'url';

const APP = pathToFileURL(new URL('../index.html', import.meta.url).pathname).href;
// 브라우저 경로: 보통은 playwright 가 알아서 찾아요.
// 특별한 위치에 깔려 있으면 CHROME_PATH 환경변수로 알려주면 됩니다.
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const b = await chromium.launch(LAUNCH);

// AI 서버는 부르지 않아요. 요청이 나갔는지만 보고 가짜 응답을 돌려줍니다.
async function open(ctxOpts, label) {
  const ctx = await b.newContext({ timezoneId: 'Asia/Seoul', ...ctxOpts });
  const page = await ctx.newPage();
  let sent = 0;
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith('file:')) return r.continue();
    if (/day-agent/.test(u)) {
      sent++;
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: '네', actions: [] }) });
    }
    if (/chart\.js|lucide|pretendard|firebase/.test(u)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.Chart=function(){this.destroy=function(){}};window.lucide={createIcons(){}};' });
    return r.fulfill({ status: 200, body: '' });
  });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(APP);
  await page.waitForFunction(() => typeof window.openAgent === 'function');
  await page.evaluate(() => openAgent());
  await page.waitForTimeout(150);
  return { page, ctx, label, sentCount: () => sent, errs };
}

const R = [];
const ok = (n, got, want) => R.push({ n, pass: JSON.stringify(got) === JSON.stringify(want), got, want });
const yes = (n, cond, got) => R.push({ n, pass: !!cond, got: got || '' });

// ── 공통: 입력칸이 textarea 인가, 붙여넣은 여러 줄이 살아 있나 ──
{
  const { page, ctx, errs } = await open({ viewport: { width: 1440, height: 900 } }, 'PC');
  ok('입력칸이 textarea', await page.evaluate(() => $('agent-input').tagName), 'TEXTAREA');

  // 여러 줄 붙여넣기 (실제 붙여넣기처럼 값을 넣고 input 이벤트 발생)
  const grew = await page.evaluate(() => {
    const t = $('agent-input');
    const before = t.getBoundingClientRect().height;
    t.value = '한 줄\n두 줄\n세 줄\n네 줄';
    t.dispatchEvent(new Event('input'));
    return { before, after: t.getBoundingClientRect().height, val: t.value };
  });
  yes('여러 줄이 그대로 담김', grew.val.split('\n').length === 4, grew.val.replace(/\n/g, '\\n'));
  yes('내용만큼 칸이 자람', grew.after > grew.before + 20, `${Math.round(grew.before)} → ${Math.round(grew.after)}`);

  // 아주 긴 내용이어도 화면을 안 잡아먹나
  const tall = await page.evaluate(() => {
    const t = $('agent-input');
    t.value = Array.from({ length: 30 }, (_, i) => '줄 ' + i).join('\n');
    t.dispatchEvent(new Event('input'));
    return t.getBoundingClientRect().height;
  });
  yes('30줄이어도 높이 제한됨(≤120)', tall <= 120, Math.round(tall));

  // PC: Enter = 보내기, Shift+Enter = 줄바꿈
  await page.evaluate(() => { const t = $('agent-input'); t.value = '가'; t.dispatchEvent(new Event('input')); t.focus(); });
  await page.keyboard.press('Shift+Enter');
  ok('PC — Shift+Enter 는 줄바꿈', await page.evaluate(() => $('agent-input').value.includes('\n')), true);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  ok('PC — Enter 로 보냄 (입력칸 비워짐)', await page.evaluate(() => $('agent-input').value), '');
  ok('PC — 보낸 뒤 칸 높이 한 줄로 복귀',
     await page.evaluate(() => Math.round($('agent-input').getBoundingClientRect().height) <= 46), true);

  if (errs.length) R.push({ n: 'PC pageerror', pass: false, got: errs.join('|'), want: '없음' });
  await ctx.close();
}

// ── 폰: Enter 는 줄바꿈이어야 함 (Shift 키가 없으니까) ──
{
  const { page, ctx, sentCount, errs } = await open({ ...devices['Pixel 5'] }, '폰');
  ok('폰으로 인식됨(IS_TOUCH)', await page.evaluate(() => IS_TOUCH), true);

  await page.evaluate(() => { const t = $('agent-input'); t.value = '가'; t.focus(); });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  ok('폰 — Enter 는 줄바꿈', await page.evaluate(() => $('agent-input').value.includes('\n')), true);
  ok('폰 — Enter 로 보내지 않음', sentCount(), 0);

  // 보내기 버튼으로는 보내져야 함
  await page.evaluate(() => { const t = $('agent-input'); t.value = '첫 줄\n둘째 줄'; });
  await page.evaluate(() => sendAgent());
  await page.waitForTimeout(500);
  ok('폰 — 버튼으로는 보내짐', sentCount(), 1);
  ok('폰 — 보낸 뒤 비워짐', await page.evaluate(() => $('agent-input').value), '');
  yes('보낸 여러 줄이 기록에 남음',
      await page.evaluate(() => JSON.stringify(getDay(dayCursor).chat || []).includes('둘째 줄')), '');

  if (errs.length) R.push({ n: '폰 pageerror', pass: false, got: errs.join('|'), want: '없음' });
  await ctx.close();
}

let bad = 0;
for (const r of R) { if (!r.pass) bad++; console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.n + (r.pass ? '' : `\n      받음: ${JSON.stringify(r.got)}  기대: ${JSON.stringify(r.want)}`)); }
console.log(bad ? `\n${bad}개 실패` : '\n전부 통과');
await b.close();
process.exit(bad ? 1 : 0);
