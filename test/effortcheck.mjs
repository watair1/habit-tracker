// AI 비서의 생각 깊이(effort) 칩 — 고르면 저장되고, 대화 요청에 같이 실려 가는지
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';

const APP = pathToFileURL(new URL('../index.html', import.meta.url).pathname).href;
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const b = await chromium.launch(LAUNCH);
const ctx = await b.newContext({ timezoneId: 'Asia/Seoul', viewport: { width: 412, height: 800 } });
const bodies = [];
await ctx.route('**/*', async r => {
  const u = r.request().url();
  if (u.startsWith('file:')) return r.continue();
  if (/onrender\.com/.test(u)) {
    if (r.request().method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"hasKey":true}' });
    bodies.push(JSON.parse(r.request().postData() || '{}'));
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"reply":"네","actions":[]}' });
  }
  if (/chart\.js|lucide|pretendard|gstatic|firebase/.test(u))
    return r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.lucide={createIcons(){}};' });
  return r.fulfill({ status: 200, body: '' });
});
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(APP);
await page.waitForFunction(() => typeof window.openAgent === 'function');

const R = []; const ok = (n, got, want) => R.push([n, JSON.stringify(got) === JSON.stringify(want), got, want]);

await page.evaluate(() => openAgent());
ok('처음엔 low', await page.textContent('#agent-effort'), 'low');
ok('메뉴는 닫혀 있음', await page.isVisible('#agent-effort-menu'), false);
await page.click('#agent-effort');
ok('누르면 메뉴가 열림', await page.isVisible('#agent-effort-menu'), true);
ok('세 가지', await page.locator('.agent-effort-opt').count(), 3);
await page.locator('.agent-effort-opt').nth(1).click();
ok('medium 고르면 칩이 바뀜', await page.textContent('#agent-effort'), 'medium');
ok('메뉴는 닫힘', await page.isVisible('#agent-effort-menu'), false);
ok('저장됨 (기기 간 동기화되는 사용자 정보)', await page.evaluate(() => loadUser().aiEffort), 'medium');

await page.click('#agent-effort');
await page.click('.agent-sheet .sheet-title');
ok('바깥 누르면 메뉴 닫힘', await page.isVisible('#agent-effort-menu'), false);

await page.fill('#agent-input', '안녕');
await page.evaluate(() => sendAgent());
await page.waitForFunction(() => document.querySelectorAll('#agent-log .agent-msg.bot').length > 0 && !document.querySelector('#agent-log .ai-spin'), null, { timeout: 10000 });
ok('대화 요청에 effort 가 실려 감', bodies.at(-1) && bodies.at(-1).effort, 'medium');

await page.reload();
await page.waitForFunction(() => typeof window.openAgent === 'function');
await page.evaluate(() => openAgent());
ok('다시 열어도 medium 기억', await page.textContent('#agent-effort'), 'medium');
ok('pageerror 없음', errs, []);

for (const [n, p, g, w] of R) console.log((p ? '  ✓ ' : '  ✗ ') + n + (p ? '' : `  받음: ${JSON.stringify(g)} 기대: ${JSON.stringify(w)}`));
console.log(R.every(a => a[1]) ? '\n전부 통과' : '\n실패 있음');
await b.close();
process.exit(R.every(a => a[1]) ? 0 : 1);
