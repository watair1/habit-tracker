// 옆으로 쓸어서 탭 넘기기 — 넘어가야 할 때 넘어가고, 막아야 할 때 막히는지
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';

const APP = pathToFileURL(new URL('../index.html', import.meta.url).pathname).href;
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const b = await chromium.launch(LAUNCH);
const ctx = await b.newContext({ timezoneId: 'Asia/Seoul', viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true });
await ctx.route('**/*', r => {
  const u = r.request().url();
  if (u.startsWith('file:')) return r.continue();
  if (/lucide/.test(u)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.lucide={createIcons(){}};' });
  if (/chart\.js|pretendard|firebase|gstatic/.test(u)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.Chart=function(){this.destroy=function(){}};' });
  return r.fulfill({ status: 200, body: '' });
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.addInitScript(() => {
  localStorage.setItem('ht_habits_v2', JSON.stringify([{ id: 'h0', name: '물', createdAt: '2026-09-01', checked: {}, category: '건강', timeSlot: '아침', freq: null, min: '' }]));
});
await page.goto(APP);
await page.waitForFunction(() => typeof window.gotoTab === 'function');
await page.waitForTimeout(300);

// 손가락 하나로 (x0,y0) → (x1,y1) 쓸기. target 은 손가락이 닿는 요소를 고르는 CSS 선택자
const swipe = (sel, dx, dy = 0, ms = 150, startX = 206) => page.evaluate(async ([sel, dx, dy, ms, startX]) => {
  const t = sel ? document.querySelector(sel) : document.elementFromPoint(startX, 400);
  const r = t.getBoundingClientRect();
  const x0 = sel ? r.left + r.width / 2 : startX, y0 = sel ? r.top + r.height / 2 : 400;
  const mk = (x, y) => new Touch({ identifier: 1, target: t, clientX: x, clientY: y });
  t.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [mk(x0, y0)], changedTouches: [mk(x0, y0)] }));
  await new Promise(r => setTimeout(r, ms));
  t.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [mk(x0 + dx, y0 + dy)] }));
  await new Promise(r => setTimeout(r, 60));
}, [sel, dx, dy, ms, startX]);
const tab = () => page.evaluate(() => document.querySelector('.tab.active').id);
const navOn = () => page.evaluate(() => [...document.querySelectorAll('#navbar .nav-btn')].findIndex(b => b.classList.contains('active')));

const R = [];
const ok = (n, got, want) => R.push({ n, pass: got === want, got, want });

ok('처음은 오늘 탭', await tab(), 'tab-today');
await swipe(null, -120);
ok('왼쪽으로 쓸면 다음 탭(하루)', await tab(), 'tab-day');
ok('탭바도 같이 옮겨감', await navOn(), 1);
ok('밀려 들어오는 움직임 표시', await page.evaluate(() => document.querySelector('.tab.active').className.includes('swipe-next')), true);
await swipe(null, 120);
ok('오른쪽으로 쓸면 이전 탭(오늘)', await tab(), 'tab-today');
await swipe(null, 120);
ok('맨 앞에서 오른쪽으로 쓸어도 그대로', await tab(), 'tab-today');
await swipe(null, -40);
ok('조금만 쓸면 안 넘어감', await tab(), 'tab-today');
await swipe(null, -90, 80);
ok('비스듬히(세로 스크롤 쪽) 쓸면 안 넘어감', await tab(), 'tab-today');
await swipe(null, -120, 0, 1200);
ok('너무 느리게 끌면 안 넘어감', await tab(), 'tab-today');
await swipe(null, -120, 0, 150, 10);
ok('화면 가장자리에서 시작하면 안 넘어감(뒤로 가기 제스처)', await tab(), 'tab-today');
await swipe('#new-habit', -120);
ok('입력칸 위에서는 안 넘어감', await tab(), 'tab-today');
await page.evaluate(() => openModal('add-modal'));
await swipe(null, -120);
ok('창이 열려 있으면 안 넘어감', await tab(), 'tab-today');
await page.evaluate(() => closeModal('add-modal'));
// 가로로 밀리는 칸 안에서는 안 넘어감
await page.evaluate(() => {
  const d = document.createElement('div'); d.id = 'hscroll';
  d.style.cssText = 'overflow-x:auto;width:200px;height:40px;white-space:nowrap';
  d.innerHTML = '<span style="display:inline-block;width:800px">긴 줄</span>';
  document.querySelector('#tab-today').prepend(d);
});
await swipe('#hscroll', -120);
ok('가로 스크롤 칸 안에서는 안 넘어감', await tab(), 'tab-today');
for (let i = 0; i < 8; i++) await swipe(null, -120);
ok('계속 쓸면 마지막 탭(분석)에서 멈춤', await tab(), 'tab-analysis');
ok('에러 없음', errs.join(' | '), '');

await b.close();
let bad = 0;
for (const r of R) { console.log(`${r.pass ? '✓' : '✗'} ${r.n}${r.pass ? '' : `  (받음 ${JSON.stringify(r.got)}, 원함 ${JSON.stringify(r.want)})`}`); if (!r.pass) bad++; }
console.log(bad ? `\n${bad}개 실패` : `\n전부 통과 (${R.length}개)`);
process.exit(bad ? 1 : 0);
