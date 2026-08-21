// 앱 껍데기 — 아이콘, 모달 스크롤, 마지막에 본 탭 기억
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';

const APP = pathToFileURL(new URL('../index.html', import.meta.url).pathname).href;
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const b = await chromium.launch(LAUNCH);
const ctx = await b.newContext({ timezoneId: 'Asia/Seoul', viewport: { width: 412, height: 800 } });

// 바깥으로 나가는 요청은 전부 가짜로 받아쳐요. 인터넷 없이도 돌게.
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

// 습관 몇 개를 미리 심어둬요. 주간 회고가 열리려면 기록이 있어야 하거든요.
await page.addInitScript(() => {
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  const ymd = x => `${x.getFullYear()}-${pad(x.getMonth()+1)}-${pad(x.getDate())}`;
  const checked = {};
  for (let i = 0; i < 14; i++) { const t = new Date(d); t.setDate(d.getDate() - i); checked[ymd(t)] = true; }
  localStorage.setItem('ht_habits_v2', JSON.stringify(
    Array.from({ length: 9 }, (_, i) => ({
      id: 'h' + i, name: '아주 긴 이름을 가진 습관 ' + i, createdAt: '2026-01-01',
      checked: { ...checked }, category: '건강', timeSlot: '아침', freq: null, min: ''
    }))
  ));
  localStorage.setItem('ht_memos_v1', JSON.stringify([
    { id: 'm1', title: '첫 아이디어', content: '내용 한 줄\n두 번째 줄 #태그하나', tags: ['태그하나'],
      createdAt: '2026-08-01', updatedAt: '2026-08-01', importance: 3, rating: 'good',
      starred: true, graduated: false, appendix: [{ text: '덧댄 한 줄', at: '2026-08-05' }] },
    { id: 'm2', title: '둘째 아이디어', content: '짧게', tags: [],
      createdAt: '2026-08-10', updatedAt: '2026-08-10', importance: 1, rating: null,
      starred: false, graduated: false, appendix: [] },
    { id: 'm3', title: '졸업한 것', content: '이건 기본 목록에선 빠져요', tags: [],
      createdAt: '2026-07-01', updatedAt: '2026-07-01', importance: 2, rating: null,
      starred: false, graduated: true, appendix: [] }
  ]));
});

await page.goto(APP);
await page.waitForFunction(() => typeof window.switchTab === 'function');

const R = [];
const ok  = (n, got, want) => R.push({ n, pass: JSON.stringify(got) === JSON.stringify(want), got, want });
const yes = (n, cond, got) => R.push({ n, pass: !!cond, got: got ?? '' });

// ── 1. 아이콘 ────────────────────────────────────────────
{
  const icons = await page.evaluate(() => {
    const any = generateIcon(192), mask = generateMaskableIcon(192);
    return { any: any.slice(0, 22), mask: mask.slice(0, 22), same: any === mask, len: any.length };
  });
  ok('아이콘이 PNG 로 나옴', icons.any, 'data:image/png;base64,');
  ok('마스크용도 PNG 로 나옴', icons.mask, 'data:image/png;base64,');
  yes('둘이 서로 다른 그림', !icons.same);
  yes('빈 그림이 아님', icons.len > 2000, icons.len);

  const man = await page.evaluate(async () => {
    const href = document.getElementById('pwa-manifest').href;
    return JSON.parse(await (await fetch(href)).text());
  });
  ok('매니페스트 배경색이 앱과 같음', man.background_color, '#0a0a0a');
  ok('any 와 maskable 을 따로 줌', man.icons.map(i => i.purpose), ['any', 'maskable']);
  yes('보라색이 남아 있지 않음',
      !/6c63ff/i.test(JSON.stringify(man)) &&
      !/6c63ff/i.test(await page.getAttribute('meta[name="theme-color"]', 'content')));
}

// ── 2. 모달 스크롤 (일주일 돌아보기) ──────────────────────
{
  await page.evaluate(() => openWeekReview());
  yes('주간 회고가 열림', await page.isVisible('#wreview-modal.open'));
  // 시트가 아래에서 올라오는 애니메이션이 있어요. 끝나기 전에 재면 위치가 어긋납니다.
  await page.locator('#wreview-modal .sheet')
    .evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));

  const sheet = page.locator('#wreview-modal .sheet');
  const box = await sheet.evaluate(el => {
    const cs = getComputedStyle(el);
    return { overflowY: cs.overflowY, scrollH: el.scrollHeight, clientH: el.clientHeight,
             bottom: el.getBoundingClientRect().bottom, winH: innerHeight };
  });
  ok('시트에 스크롤 규칙이 붙음', box.overflowY, 'auto');
  yes('시트가 화면 밖으로 안 삐져나감', box.bottom <= box.winH + 1, `${Math.round(box.bottom)} / ${box.winH}`);
  yes('내용이 화면보다 길다 (스크롤할 거리가 있음)', box.scrollH > box.clientH, `${box.scrollH} > ${box.clientH}`);

  const moved = await sheet.evaluate(el => { el.scrollTop = 9999; return el.scrollTop; });
  yes('실제로 아래로 스크롤됨', moved > 0, moved);

  // 맨 아래 저장 버튼까지 닿는지
  await page.locator('#wreview-modal .btn-confirm').scrollIntoViewIfNeeded();
  yes('맨 아래 저장 버튼이 보임', await page.locator('#wreview-modal .btn-confirm').isVisible());
  await page.evaluate(() => closeModal('wreview-modal'));
}

// ── 3. 마지막에 본 탭 기억 ───────────────────────────────
{
  await page.evaluate(() => gotoTab('stats'));
  await page.waitForTimeout(150);
  ok('통계 탭으로 옮겨짐', await page.evaluate(() => $('tab-stats').classList.contains('active')), true);

  await page.reload();
  await page.waitForFunction(() => typeof window.switchTab === 'function');
  await page.waitForTimeout(200);
  ok('새로 켜도 통계 탭 그대로', await page.evaluate(() => $('tab-stats').classList.contains('active')), true);
  ok('아래 버튼도 통계에 불이 들어옴',
     await page.evaluate(() => [...document.querySelectorAll('.nav-btn')]
       .findIndex(b => b.classList.contains('active'))), 2);
  ok('오늘 탭은 꺼져 있음', await page.evaluate(() => $('tab-today').classList.contains('active')), false);

  // 오래됐으면 (4시간 넘으면) 그냥 오늘로
  await page.evaluate(() => {
    const v = JSON.parse(localStorage.getItem('ht_lasttab_v1'));
    v.at = Date.now() - 5 * 60 * 60 * 1000;
    localStorage.setItem('ht_lasttab_v1', JSON.stringify(v));
  });
  await page.reload();
  await page.waitForFunction(() => typeof window.switchTab === 'function');
  await page.waitForTimeout(200);
  ok('5시간 지났으면 오늘 탭으로', await page.evaluate(() => $('tab-today').classList.contains('active')), true);

  // 백업·동기화에 끼어들지 않아야 함
  yes('탭 기억은 백업 대상이 아님', await page.evaluate(() =>
    !BACKUP_KEYS.some(k => K[k] === 'ht_lasttab_v1') &&
    !SYNC_STORES.some(([, key]) => key === 'ht_lasttab_v1')));
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
