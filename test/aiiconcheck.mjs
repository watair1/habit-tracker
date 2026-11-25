// AI 아이콘 — 레벨로 열리고, 고르면 앱 안 AI 자리가 다 같이 바뀌는지
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';

const APP = pathToFileURL(new URL('../index.html', import.meta.url).pathname).href;
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const b = await chromium.launch(LAUNCH);

async function open(xp, aiIcon) {
  const ctx = await b.newContext({ timezoneId: 'Asia/Seoul', viewport: { width: 412, height: 860 } });
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
  await page.addInitScript(([xp, aiIcon]) => {
    localStorage.setItem('ht_user_v2', JSON.stringify({ xp, achievements: [], totalChecks: 0, ...(aiIcon ? { aiIcon } : {}) }));
    localStorage.setItem('ht_habits_v2', JSON.stringify([{ id: 'h0', name: '물', createdAt: '2026-09-01', checked: {}, category: '건강', timeSlot: '아침', freq: null, min: '' }]));
  }, [xp, aiIcon]);
  await page.goto(APP);
  await page.waitForFunction(() => typeof window.aiIconNow === 'function');
  await page.waitForTimeout(200);
  return { page, ctx, errs };
}
const R = [];
const ok = (n, got, want) => R.push({ n, pass: JSON.stringify(got) === JSON.stringify(want), got, want });
const cur = p => p.evaluate(() => aiIconNow());
const var_ = p => p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ai-ico'));

{ // Lv.1: 말하는 노드만
  const { page, ctx, errs } = await open(0);
  ok('Lv.1 기본은 움직이는 커서', await cur(page), 'cursor');
  ok('화면에 그림이 들어감', (await var_(page)).includes('data:image/svg+xml'), true);
  ok('AI 버튼이 새 아이콘을 씀', await page.evaluate(() => !!document.querySelector('#agent-fab .ai-ico') && !document.querySelector('#agent-fab [data-lucide]')), true);
  ok('AI 자리에 반짝이가 안 남음', await page.evaluate(() => [...document.querySelectorAll('[data-lucide="sparkles"]')].filter(e => /AI/.test(e.parentElement.textContent)).length), 0);
  await page.evaluate(() => gotoTab('growth'));
  ok('성장 탭에 열린 아이콘 1개', await page.evaluate(() => document.querySelectorAll('#ai-icon-picker .ai-opt:not([disabled])').length), 1);
  ok('잠긴 건 열리는 레벨 표시', await page.evaluate(() => document.querySelector('#ai-icon-picker .ai-opt[disabled]').textContent.includes('Lv.')), true);
  ok('에러 없음', errs.join(' | '), '');
  await ctx.close();
}
{ // Lv.4 (500XP): 3개 열림, 고르면 바뀜
  const { page, ctx, errs } = await open(500);
  ok('Lv.4 고른 게 없으면 가장 최근에 열린 작은 신경망', await cur(page), 'net');
  await page.evaluate(() => gotoTab('growth'));
  ok('열린 아이콘 3개', await page.evaluate(() => document.querySelectorAll('#ai-icon-picker .ai-opt:not([disabled])').length), 3);
  const before = await var_(page);
  await page.evaluate(() => setAiIcon('talk'));
  ok('고르면 바뀜', await cur(page), 'talk');
  ok('화면 그림도 바뀜', (await var_(page)) !== before, true);
  ok('저장됨', await page.evaluate(() => JSON.parse(localStorage.getItem('ht_user_v2')).aiIcon), 'talk');
  await page.evaluate(() => setAiIcon('orbit'));
  ok('잠긴 건 못 고름', await cur(page), 'talk');
  ok('에러 없음', errs.join(' | '), '');
  await ctx.close();
}
{ // 레벨업으로 새 아이콘이 열리면 바로 바뀜
  const { page, ctx, errs } = await open(1480, 'net');  // Lv.5, 1500 에서 Lv.6
  ok('레벨업 전', await cur(page), 'net');
  await page.evaluate(() => addXP(30));
  ok('Lv.6 이 되면 궤도로 바뀜', await cur(page), 'orbit');
  ok('알림에 새 아이콘 이름', await page.evaluate(() => document.body.textContent.includes("새 AI 아이콘 '궤도'")), true);
  ok('에러 없음', errs.join(' | '), '');
  await ctx.close();
}
await b.close();
let bad = 0;
for (const r of R) { console.log(`${r.pass ? '✓' : '✗'} ${r.n}${r.pass ? '' : `  (받음 ${JSON.stringify(r.got)}, 원함 ${JSON.stringify(r.want)})`}`); if (!r.pass) bad++; }
console.log(bad ? `\n${bad}개 실패` : `\n전부 통과 (${R.length}개)`);
process.exit(bad ? 1 : 0);
