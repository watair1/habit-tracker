// 하단 탭바 — 레벨 해금, 고르기, 레벨업 자동 전환, 6가지 모양이 다 제대로 옮겨가는지
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';

const APP = pathToFileURL(new URL('../index.html', import.meta.url).pathname).href;
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const SHOTS = process.env.NAV_SHOTS || '';
const b = await chromium.launch(LAUNCH);

async function open(user, extra) {
  const ctx = await b.newContext({ timezoneId: 'Asia/Seoul', viewport: { width: 412, height: 860 } });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith('file:')) return r.continue();
    if (/lucide/.test(u)) return r.fulfill({ status:200, contentType:'application/javascript', body:`window.lucide={createIcons(){
      document.querySelectorAll('i[data-lucide]').forEach(e=>{const s=document.createElementNS('http://www.w3.org/2000/svg','svg');
      s.setAttribute('viewBox','0 0 24 24');s.setAttribute('fill','none');s.setAttribute('stroke','currentColor');
      s.innerHTML='<circle cx="12" cy="12" r="8"/>';e.replaceWith(s);});}};` });
    if (/chart\.js|pretendard|firebase|gstatic/.test(u))
      return r.fulfill({ status:200, contentType:'application/javascript', body:'window.Chart=function(){this.destroy=function(){}};' });
    return r.fulfill({ status:200, body:'' });
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(([user, extra]) => {
    localStorage.setItem('ht_user_v2', JSON.stringify({ xp: 0, achievements: [], totalChecks: 0, ...user }));
    localStorage.setItem('ht_habits_v2', JSON.stringify([{ id:'h0', name:'물', createdAt:'2026-09-01', checked:{}, category:'건강', timeSlot:'아침', freq:null, min:'' }]));
    if (extra) for (const [k,v] of Object.entries(extra)) localStorage.setItem(k, v);
  }, [user, extra]);
  await page.goto(APP);
  await page.waitForFunction(() => typeof window.navApply === 'function');
  await page.waitForTimeout(300);
  return { page, ctx, errs };
}

const R = [];
const ok  = (n, got, want) => R.push({ n, pass: JSON.stringify(got) === JSON.stringify(want), got, want });
const yes = (n, c, got) => R.push({ n, pass: !!c, got: got ?? '' });
const styleOf = page => page.evaluate(() => $('navbar').className.replace('navbar ns-', ''));

// ── 레벨에 따라 열리는 모양 ─────────────────────────────
for (const [xp, want] of [[0,'expand'],[120,'pill'],[300,'fill'],[600,'notch'],[1000,'bubble'],[2000,'bulge']]) {
  const { page, ctx } = await open({ xp });
  ok(`XP ${xp} → ${want}`, await styleOf(page), want);
  await ctx.close();
}
{
  const { page, ctx } = await open({ xp: 600, navStyle: 'pill' });
  ok('열린 것 중 고른 게 있으면 그걸 씀', await styleOf(page), 'pill');
  await ctx.close();
}
{
  const { page, ctx } = await open({ xp: 600, navStyle: 'bulge' });
  ok('잠긴 걸 골라뒀으면(다른 기기 등) 열린 최고로', await styleOf(page), 'notch');
  await ctx.close();
}

// ── 성장 탭에서 고르기 ─────────────────────────────────
{
  const { page, ctx, errs } = await open({ xp: 600 });
  await page.evaluate(() => gotoTab('growth'));
  await page.waitForTimeout(300);
  ok('고르기 칸 6개', await page.locator('#ns-picker .ns-opt').count(), 6);
  ok('Lv.4 면 4개가 열림', await page.locator('#ns-picker .ns-opt:not([disabled])').count(), 4);
  yes('잠긴 건 몇 레벨에서 열리는지 알려줌', /Lv\.5 레전드에서 열려요/.test(await page.textContent('#ns-picker')));
  await page.locator('#ns-picker .ns-opt').nth(1).click();
  await page.waitForTimeout(200);
  ok('누르면 바로 바뀜', await styleOf(page), 'pill');
  ok('고른 게 저장됨', await page.evaluate(() => loadUser().navStyle), 'pill');
  yes('쓰는 중 표시', /쓰는 중/.test(await page.locator('#ns-picker .ns-opt.on').textContent()));
  await page.locator('#ns-picker .ns-opt').nth(5).click({ force: true });
  ok('잠긴 건 눌러도 안 바뀜', await styleOf(page), 'pill');
  if (errs.length) R.push({ n:'고르기 pageerror', pass:false, got:errs.join(' | ') });
  await ctx.close();
}

// ── 레벨업하면 자동으로 바뀌고 알려줌 ──────────────────
{
  const { page, ctx, errs } = await open({ xp: 490, navStyle: 'expand' });
  ok('레벨업 전', await styleOf(page), 'expand');
  await page.evaluate(() => addXP(20));
  await page.waitForTimeout(200);
  ok('Lv.4 가 되면 새 모양으로', await styleOf(page), 'notch');
  ok('새 모양이 저장됨', await page.evaluate(() => loadUser().navStyle), 'notch');
  yes('새 탭바가 열렸다고 알려줌', /새 탭바/.test(await page.textContent('#toast').catch(() => '')), await page.textContent('#toast').catch(() => ''));
  if (errs.length) R.push({ n:'레벨업 pageerror', pass:false, got:errs.join(' | ') });
  await ctx.close();
}

// ── 6가지 모양이 다 제자리로 옮겨가는지 ────────────────
for (const s of ['expand','pill','fill','notch','bubble','bulge']) {
  const { page, ctx, errs } = await open({ xp: 2000, navStyle: s });
  await page.evaluate(() => gotoTab('goals'));
  await page.waitForTimeout(200);
  if (s === 'bubble') yes(`${s}: 거품이 생김`, await page.locator('.nav-bub').count() > 0);
  if (s === 'fill')   yes(`${s}: 원이 퍼짐`, await page.locator('.nav-ring').count() > 0);
  await page.waitForTimeout(900);
  const r = await page.evaluate(s => {
    const btn = document.querySelectorAll('#navbar .nav-btn')[4].getBoundingClientRect(), cx = btn.left + btn.width/2;
    const el = s==='pill' ? document.querySelector('.nav-pill') : s==='notch' ? document.querySelector('.nav-disc') : null;
    const off = el ? Math.round(el.getBoundingClientRect().left + el.getBoundingClientRect().width/2 - cx) : 0;
    const tab = document.querySelector('.tab.active').id;
    const path = s==='bulge' ? (document.querySelector('.nav-shape path').getAttribute('d')||'').length : 1;
    return { off, tab, path };
  }, s);
  ok(`${s}: 목표 탭이 열림`, r.tab, 'tab-goals');
  ok(`${s}: 표시가 탭 가운데에 멈춤`, Math.abs(r.off) <= 1, true);
  if (s === 'bulge') yes(`${s}: 언덕이 그려짐`, r.path > 100, r.path);
  if (SHOTS) await page.locator('.bottom-nav').screenshot({ path: `${SHOTS}/nav-${s}.png` });
  if (errs.length) R.push({ n:`${s} pageerror`, pass:false, got:errs.join(' | ') });
  await ctx.close();
}

// ── 잠깐 나갔다 와서 보던 탭으로 되돌아갈 때도 탭바가 거기 있는지 ──
{
  const { page, ctx, errs } = await open({ xp: 120, navStyle: 'pill' },
    { ht_lasttab_v1: JSON.stringify({ tab: 'stats', at: Date.now() }) });
  await page.waitForTimeout(300);
  const off = await page.evaluate(() => {
    const btn = document.querySelectorAll('#navbar .nav-btn')[2].getBoundingClientRect(), p = document.querySelector('.nav-pill').getBoundingClientRect();
    return Math.round(p.left + p.width/2 - (btn.left + btn.width/2));
  });
  ok('되돌아간 탭에 알약이 있음', Math.abs(off) <= 1, true);
  if (errs.length) R.push({ n:'되돌리기 pageerror', pass:false, got:errs.join(' | ') });
  await ctx.close();
}

let bad = 0;
for (const r of R) { if (!r.pass) bad++; console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.n + (r.pass ? '' : `\n      받음: ${JSON.stringify(r.got)}  기대: ${JSON.stringify(r.want)}`)); }
console.log(bad ? `\n${bad}개 실패` : '\n전부 통과');
await b.close();
process.exit(bad ? 1 : 0);
