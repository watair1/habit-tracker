// 주간 회고 — 언제 뜨는지, 숫자가 맞는지, 고른 게 남는지
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';

const APP = pathToFileURL(new URL('../index.html', import.meta.url).pathname).href;
// 브라우저 경로: 보통은 playwright 가 알아서 찾아요.
// 특별한 위치에 깔려 있으면 CHROME_PATH 환경변수로 알려주면 됩니다.
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const b = await chromium.launch(LAUNCH);

// 회고 카드는 요일을 타기 때문에, 시계를 특정 날짜로 고정해서 봐야 해요.
// 2026-08-07 은 금요일, 08-08 토, 08-09 일, 08-05 수요일입니다.
async function onDate(iso, fn) {
  const ctx = await b.newContext({ timezoneId: 'Asia/Seoul' });
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date(`${iso}T10:00:00+09:00`) });
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith('file:')) return r.continue();
    if (/chart\.js|lucide|pretendard|firebase/.test(u)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.Chart=function(){this.destroy=function(){}};window.lucide={createIcons(){}};' });
    return r.fulfill({ status: 200, body: '' });
  });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(APP);
  await page.waitForFunction(() => typeof window.renderWeekReviewCard === 'function');
  const out = await page.evaluate(fn);
  await ctx.close();
  return { out, errs };
}

const R = [];
const push = rows => rows.forEach(r => R.push(r));

// 습관 두 개를 심어두는 공통 준비 코드 (문자열로 넘겨 페이지 안에서 실행)
const SEED = `
  const T = todayStr();
  const ws = weekStartOf(T);
  const day = i => addDaysStr(ws, i);
  const prev = i => addDaysStr(addDaysStr(ws, -7), i);
  // 매일 습관 '운동': 이번 주 일~목 중 3번, 지난주 7번 전부
  const ex = { id: 'ex', name: '운동', createdAt: addDaysStr(ws, -30), checked: {}, freq: { type: 'daily' } };
  [0, 1, 3].forEach(i => ex.checked[day(i)] = true);
  [0,1,2,3,4,5,6].forEach(i => ex.checked[prev(i)] = true);
  // 주 3회 습관 '독서': 이번 주 1번, 지난주 3번
  const rd = { id: 'rd', name: '독서', createdAt: addDaysStr(ws, -30), checked: {}, freq: { type: 'weekly', times: 3 } };
  rd.checked[day(1)] = true;
  [0, 2, 4].forEach(i => rd.checked[prev(i)] = true);
  localStorage.setItem('ht_habits_v2', JSON.stringify([ex, rd]));
  localStorage.setItem('ht_review_v1', JSON.stringify({}));
`;

// ── 1) 금요일: 카드가 뜨고 숫자가 맞는가 ──
{
  const { out, errs } = await onDate('2026-08-07', new Function(`
    ${SEED}
    const R = [];
    const ok = (n, got, want) => R.push({ n, pass: JSON.stringify(got) === JSON.stringify(want), got, want });
    renderWeekReviewCard();
    const html = document.getElementById('wreview-box').innerHTML;
    R.push({ n: '금요일에 회고 카드 뜸', pass: html.includes('이번 주 돌아보기'), got: html.slice(0, 60) });

    // 이번 주는 일~금 6일이 지났고 운동은 3번 했음 → 3/6
    const rows = weekReport(loadHabits(), weekStartOf(T), T);
    const exr = rows.find(r => r.h.id === 'ex');
    ok('매일 습관: 이번 주 3번', exr.done, 3);
    ok('매일 습관: 해야 했던 건 6번(일~금)', exr.target, 6);
    ok('매일 습관: 50%', exr.pct, 50);
    ok('지난주는 7/7 = 100%', exr.pPct, 100);
    ok('변화는 -50', exr.delta, -50);

    // 주 3회 습관은 목표가 요일과 무관하게 3
    const rdr = rows.find(r => r.h.id === 'rd');
    ok('주3회: 이번 주 1번', rdr.done, 1);
    ok('주3회: 목표는 3', rdr.target, 3);
    ok('주3회: 지난주 100%', rdr.pPct, 100);

    // 모달이 열리고 내용이 채워지나
    openWeekReview();
    const body = document.getElementById('wr-body').innerHTML;
    R.push({ n: '모달에 총점 표시', pass: body.includes('wr-total-n'), got: '' });
    R.push({ n: '습관 이름이 다 나옴', pass: body.includes('운동') && body.includes('독서'), got: '' });
    R.push({ n: '기본 선택은 가장 무너진 것', pass: document.querySelector('.wr-pick.on').dataset.id === 'rd', got: document.querySelector('.wr-pick.on').dataset.id });

    // 저장하면 기록되고 카드가 사라지나
    pickWeekFocus('ex');
    document.getElementById('wr-note').value = '저녁 약속 있는 날 무너짐';
    saveWeekReview();
    const saved = loadWeekReviews()[weekStartOf(T)];
    ok('회고 저장됨', saved.focusHabitId, 'ex');
    ok('메모 저장됨', saved.note, '저녁 약속 있는 날 무너짐');
    renderWeekReviewCard();
    const after = document.getElementById('wreview-box').innerHTML;
    R.push({ n: '저장 후 카드 사라짐', pass: !after.includes('이번 주 돌아보기'), got: after.slice(0, 60) });
    R.push({ n: '고른 습관이 띠로 남음', pass: after.includes('이번 주 집중') && after.includes('운동'), got: after.slice(0, 80) });

    // 습관 하나도 안 고르면 저장이 막히나
    _wrPick = '';
    saveWeekReview();
    ok('안 고르면 저장 안 됨', loadWeekReviews()[weekStartOf(T)].focusHabitId, 'ex');
    return R;
  `));
  push(out); if (errs.length) R.push({ n: '금요일 pageerror', pass: false, got: errs.join('|'), want: '없음' });
}

// ── 2) 수요일: 카드가 안 떠야 함 ──
{
  const { out, errs } = await onDate('2026-08-05', new Function(`
    ${SEED}
    const R = [];
    renderWeekReviewCard();
    const html = document.getElementById('wreview-box').innerHTML;
    R.push({ n: '수요일엔 카드 안 뜸', pass: !html.includes('이번 주 돌아보기'), got: html.slice(0, 60) });
    return R;
  `));
  push(out); if (errs.length) R.push({ n: '수요일 pageerror', pass: false, got: errs.join('|'), want: '없음' });
}

// ── 3) 토요일: 카드가 떠야 함 ──
{
  const { out, errs } = await onDate('2026-08-08', new Function(`
    ${SEED}
    const R = [];
    renderWeekReviewCard();
    R.push({ n: '토요일엔 카드 뜸', pass: document.getElementById('wreview-box').innerHTML.includes('이번 주 돌아보기'), got: '' });
    return R;
  `));
  push(out); if (errs.length) R.push({ n: '토요일 pageerror', pass: false, got: errs.join('|'), want: '없음' });
}

// ── 4) 습관이 없으면 카드도 없어야 함 ──
{
  const { out } = await onDate('2026-08-07', new Function(`
    const R = [];
    localStorage.setItem('ht_habits_v2', JSON.stringify([]));
    localStorage.setItem('ht_review_v1', JSON.stringify({}));
    renderWeekReviewCard();
    R.push({ n: '습관 없으면 카드 없음', pass: document.getElementById('wreview-box').innerHTML === '', got: document.getElementById('wreview-box').innerHTML });
    let err = '';
    try { render(); } catch (e) { err = e.message; }
    R.push({ n: '빈 상태에서도 렌더 정상', pass: err === '', got: err });
    return R;
  `));
  push(out);
}

// ── 5) 습관을 만들기 전 주는 책임을 묻지 않는가 ──
{
  const { out } = await onDate('2026-08-07', new Function(`
    const R = [];
    const ok = (n, got, want) => R.push({ n, pass: JSON.stringify(got) === JSON.stringify(want), got, want });
    const T = todayStr(), ws = weekStartOf(T);
    // 수요일에 만든 습관 → 이번 주 목표는 수·목·금 3일뿐
    const h = { id: 'n', name: '새습관', createdAt: addDaysStr(ws, 3), checked: {}, freq: { type: 'daily' } };
    ok('만든 날부터만 셈', weekTarget(h, ws, T), 3);
    ok('만들기 전 주는 0', weekTarget(h, addDaysStr(ws, -7)), 0);
    // 특정 요일 습관(월·수·금)
    const d = { id: 'd', name: '요일습관', createdAt: addDaysStr(ws, -30), checked: {}, freq: { type: 'days', days: [1, 3, 5] } };
    ok('요일 습관은 해당 요일만', weekTarget(d, ws, T), 3);
    return R;
  `));
  push(out);
}

let bad = 0;
for (const r of R) { if (!r.pass) bad++; console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.n + (r.pass ? '' : `\n      받음: ${JSON.stringify(r.got)}  기대: ${JSON.stringify(r.want)}`)); }
console.log(bad ? `\n${bad}개 실패` : '\n전부 통과');
await b.close();
process.exit(bad ? 1 : 0);
