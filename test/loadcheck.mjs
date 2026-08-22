// 앱을 켤 때 뭘 내려받는지 — 첫 화면에 안 쓰는 건 안 받아야 해요
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';

const APP = pathToFileURL(new URL('../index.html', import.meta.url).pathname).href;
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const b = await chromium.launch(LAUNCH);

// 진짜처럼 굴되 내용만 가짜인 라이브러리를 돌려줘요. 무엇을 언제 부르는지 기록합니다.
async function open({ failChart = false } = {}) {
  const ctx = await b.newContext({ timezoneId: 'Asia/Seoul', viewport: { width: 412, height: 800 } });
  const asked = [];
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith('file:')) return r.continue();
    asked.push(u);
    if (/chart\.js/.test(u)) {
      if (failChart) return r.abort();          // 인터넷이 끊긴 상황
      return r.fulfill({ status:200, contentType:'application/javascript', body:`
        window.Chart=function(c,cfg){this.cfg=cfg;this.destroy=function(){window.__destroyed=(window.__destroyed||0)+1};};` });
    }
    if (/lucide/.test(u))
      return r.fulfill({ status:200, contentType:'application/javascript',
        body:'window.lucide={createIcons(){window.__icons=(window.__icons||0)+1}};' });
    if (/firebase/.test(u))
      return r.fulfill({ status:200, contentType:'application/javascript', body:`
        window.firebase=window.firebase||{apps:[],initializeApp(){this.apps.push(1);return{}},
          auth(){return{onAuthStateChanged(){},getRedirectResult(){return Promise.resolve()},currentUser:null}},
          firestore(){return{}}};` });
    return r.fulfill({ status:200, body:'' });
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('ht_habits_v2', JSON.stringify(
      Array.from({length:3},(_,i)=>({id:'h'+i,name:'습관'+i,createdAt:'2026-08-01',
        checked:{'2026-08-20':true},category:'건강',timeSlot:'아침',freq:null,min:''}))));
    localStorage.setItem('ht_mood_v1', JSON.stringify({'2026-08-20':'좋음'}));
  });
  await page.goto(APP);
  await page.waitForSelector('.check-btn', { state:'visible' });
  return { page, ctx, asked, errs };
}

const R = [];
const yes = (n, cond, got) => R.push({ n, pass: !!cond, got: got ?? '' });
const ok  = (n, got, want) => R.push({ n, pass: JSON.stringify(got)===JSON.stringify(want), got, want });
const has = (list, re) => list.some(u => re.test(u));

// ── 첫 화면 ──────────────────────────────────────────────
{
  const { page, ctx, asked, errs } = await open();
  yes('습관 목록이 뜸', await page.locator('.check-btn').count() > 0);
  yes('첫 화면에선 Chart.js 를 안 받음', !has(asked, /chart\.js/), asked.filter(u=>/chart/.test(u)).length);

  // Firebase 는 화면을 그린 뒤에 뒤에서 붙어요
  yes('첫 화면을 막지 않음 (체크 버튼이 이미 눌림)', await page.locator('.check-btn').first().isEnabled());
  await page.waitForTimeout(600);
  yes('화면 그린 뒤엔 Firebase 를 받아옴', has(asked, /firebase-app/), '');

  // lucide 는 defer 라 늦게 와도 아이콘이 그려져야 해요
  yes('아이콘이 그려짐', await page.evaluate(() => window.__icons > 0), await page.evaluate(()=>window.__icons));

  // 실제로 체크가 되는지 (첫 화면에서 바로 쓸 수 있어야 함)
  await page.locator('.check-btn').first().click();
  await page.waitForTimeout(200);
  yes('바로 체크됨', await page.evaluate(() => !!loadHabits()[0].checked[todayStr()]));
  if (errs.length) R.push({ n:'첫 화면 pageerror', pass:false, got:errs.join(' | ') });
  await ctx.close();
}

// ── 통계 탭에 들어가야 Chart.js ──────────────────────────
{
  const { page, ctx, asked, errs } = await open();
  await page.evaluate(() => gotoTab('stats'));
  await page.waitForFunction(() => typeof Chart !== 'undefined', { timeout: 5000 });
  await page.waitForTimeout(400);
  yes('통계 탭에서 Chart.js 를 받아옴', has(asked, /chart\.js/));

  const drawn = await page.evaluate(() => Object.keys(CHARTS));
  yes('그래프가 실제로 그려짐', drawn.length >= 2, drawn.join(','));
  yes('통계 숫자도 채워짐', (await page.textContent('#s-total')) !== '0', await page.textContent('#s-total'));

  // 두 번 들어가도 캔버스 재사용 에러가 안 나야 해요 (전에 그린 걸 지우고 그림)
  await page.evaluate(() => { gotoTab('today'); gotoTab('stats'); });
  await page.waitForTimeout(500);
  yes('다시 들어가도 그래프가 살아 있음', (await page.evaluate(() => Object.keys(CHARTS).length)) >= 2);
  yes('전에 그린 건 지우고 다시 그림', await page.evaluate(() => window.__destroyed > 0), await page.evaluate(()=>window.__destroyed));

  // 같은 파일을 두 번 받지는 않아야
  ok('Chart.js 는 한 번만 받음', asked.filter(u => /chart\.js/.test(u)).length, 1);
  if (errs.length) R.push({ n:'통계 탭 pageerror', pass:false, got:errs.join(' | ') });
  await ctx.close();
}

// ── 인터넷이 없어 Chart.js 를 못 받을 때 ────────────────
{
  const { page, ctx, errs } = await open({ failChart: true });
  await page.evaluate(() => gotoTab('stats'));
  await page.waitForTimeout(900);
  yes('그래프를 못 받아도 통계 숫자는 나옴', (await page.textContent('#s-total')) !== '', await page.textContent('#s-total'));
  yes('히트맵도 그려짐', await page.locator('#heatmap .hm-day').count() > 0);
  yes('앱이 안 죽음', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

let bad = 0;
for (const r of R) {
  if (!r.pass) bad++;
  console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.n + (r.pass ? '' : `\n      받음: ${JSON.stringify(r.got)}`));
}
console.log(bad ? `\n${bad}개 실패` : '\n전부 통과');
await b.close();
process.exit(bad ? 1 : 0);
