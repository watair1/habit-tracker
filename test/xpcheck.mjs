// 경험치 — 체크/취소를 반복해도 한 번만 들어오는지
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';

const APP = pathToFileURL(new URL('../index.html', import.meta.url).pathname).href;
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const b = await chromium.launch(LAUNCH);
const ctx = await b.newContext({ timezoneId: 'Asia/Seoul', viewport: { width: 412, height: 800 } });
await ctx.route('**/*', r => {
  const u = r.request().url();
  if (u.startsWith('file:')) return r.continue();
  if (/chart\.js|lucide|pretendard|firebase|gstatic/.test(u))
    return r.fulfill({ status: 200, contentType: 'application/javascript',
      body: 'window.Chart=function(){this.destroy=function(){}};window.lucide={createIcons(){}};' });
  return r.fulfill({ status: 200, body: '' });
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));

const seed = (n = 1) => page.addInitScript(n => {
  localStorage.setItem('ht_habits_v2', JSON.stringify(
    Array.from({ length: n }, (_, i) => ({
      id: 'h' + i, name: '습관' + i, createdAt: '2026-08-01',
      checked: {}, category: '건강', timeSlot: '아침', freq: null, min: '가볍게'
    }))));
  localStorage.setItem('ht_user_v2', JSON.stringify({ xp: 0, achievements: [], totalChecks: 0 }));
}, n);

await seed(1);
await page.goto(APP);
await page.waitForFunction(() => typeof window.setCheck === 'function');

const R = [];
const ok  = (n, got, want) => R.push({ n, pass: JSON.stringify(got) === JSON.stringify(want), got, want });
const yes = (n, cond, got) => R.push({ n, pass: !!cond, got: got ?? '' });
const xp  = () => page.evaluate(() => loadUser().xp);

// ── 체크 → 취소 → 체크 를 반복해도 XP 는 한 번만 ────────
{
  await page.evaluate(() => toggle(0));
  const first = await xp();
  yes('처음 체크하면 XP 들어옴', first > 0, first);

  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => toggle(0));      // 취소
    await page.evaluate(() => toggle(0));      // 다시 체크
  }
  ok('5번 껐다 켜도 XP 그대로', await xp(), first);
  ok('체크는 되어 있음', await page.evaluate(() => !!loadHabits()[0].checked[todayStr()]), true);

  // 취소한 상태로 두면 기록은 지워지되, 준 XP 기록은 남아 있어야 해요
  await page.evaluate(() => toggle(0));
  ok('취소하면 체크는 지워짐', await page.evaluate(() => !!loadHabits()[0].checked[todayStr()]), false);
  yes('준 XP 기록은 남아 있음', await page.evaluate(() => !!loadHabits()[0].paid[todayStr()]));
  ok('취소해도 XP 는 안 깎임', await xp(), first);
  await page.evaluate(() => toggle(0));
}

// ── 최소 → 완료 로 올리면 차액만 ────────────────────────
{
  await page.evaluate(() => {
    const hs = loadHabits().map(h => ({ ...h, checked: {}, paid: {} }));
    hs.push({ id: 'never', name: '안 할 습관', createdAt: '2026-08-01',
              checked: {}, category: '건강', timeSlot: '아침', freq: null, min: '' });
    saveHabits(hs);
    saveUser({ xp: 0, achievements: ACHS.map(a => a.id), totalChecks: 0 });
  });
  await page.evaluate(() => toggleMin(0));
  const afterMin = await xp();
  ok('최소 버전은 5 XP', afterMin, 5);

  await page.evaluate(() => toggle(0));
  ok('완료로 올리면 차액 5만 더 (총 10)', await xp(), 10);

  await page.evaluate(() => toggleMin(0));    // 다시 최소로 내림
  ok('도로 최소로 내려도 안 깎이고 안 늘어남', await xp(), 10);
  await page.evaluate(() => toggle(0));
  ok('또 완료로 올려도 그대로', await xp(), 10);
}

// ── 하루 전부 완료 보너스도 한 번만 ─────────────────────
{
  await page.evaluate(() => { localStorage.clear(); });
  await seed(2);
  await page.reload();
  await page.waitForFunction(() => typeof window.setCheck === 'function');

  await page.evaluate(() => { toggle(0); toggle(1); });
  const full = await xp();
  yes('둘 다 하면 보너스 20 포함', full >= 40, full);       // 10 + 10 + 20

  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => toggle(1));      // 하나 풀고
    await page.evaluate(() => toggle(1));      // 다시 채우고
  }
  ok('풀었다 채워도 보너스 재지급 없음', await xp(), full);
}

// ── 하루 탭에서 체크해도 같은 규칙 ──────────────────────
{
  await page.evaluate(() => { localStorage.clear(); });
  await seed(1);
  await page.reload();
  await page.waitForFunction(() => typeof window.toggleHabitDate === 'function');

  await page.evaluate(() => toggleHabitDate('h0', '2026-08-20'));
  const a = await xp();
  yes('하루 탭 체크도 XP 들어옴', a > 0, a);
  for (let i = 0; i < 4; i++) await page.evaluate(() => {
    toggleHabitDate('h0', '2026-08-20'); toggleHabitDate('h0', '2026-08-20');
  });
  ok('하루 탭에서 반복해도 한 번만', await xp(), a);

  // 다른 날짜는 따로 계산돼야 해요
  await page.evaluate(() => toggleHabitDate('h0', '2026-08-19'));
  yes('다른 날은 새로 XP 들어옴', (await xp()) > a, await xp());
}

// ── 총 완료 횟수가 실제 기록과 맞는지 ───────────────────
{
  const n = await page.evaluate(() => {
    // 예전 버그로 부풀려진 숫자를 일부러 심어둡니다
    const u = loadUser(); u.totalChecks = 9999; saveUser(u);
    checkAchs();
    return { stored: loadUser().totalChecks, real: habitCheckTotal(loadHabits()) };
  });
  ok('부풀려진 횟수가 실제 값으로 고쳐짐', n.stored, n.real);
  yes('실제 값이 말이 되는 숫자', n.real > 0 && n.real < 10, n.real);

  const after = await page.evaluate(() => {
    toggleHabitDate('h0', '2026-08-19');       // 하나 취소
    checkAchs();
    return loadUser().totalChecks;
  });
  yes('취소하면 횟수도 줄어듦', after === n.real - 1, `${n.real} → ${after}`);
}

if (errs.length) R.push({ n: 'pageerror', pass: false, got: errs.join(' | '), want: '없음' });

let bad = 0;
for (const r of R) {
  if (!r.pass) bad++;
  console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.n +
    (r.pass ? '' : `\n      받음: ${JSON.stringify(r.got)}  기대: ${JSON.stringify(r.want)}`));
}
console.log(bad ? `\n${bad}개 실패` : '\n전부 통과');
await b.close();
process.exit(bad ? 1 : 0);
