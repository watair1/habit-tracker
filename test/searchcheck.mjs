// 기능 찾기 — 검색이 걸리는지, 40개 항목이 전부 진짜로 그 자리까지 데려다주는지
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';

const APP = pathToFileURL(new URL('../index.html', import.meta.url).pathname).href;
// 브라우저 경로: 보통은 playwright 가 알아서 찾아요.
// 특별한 위치에 깔려 있으면 CHROME_PATH 환경변수로 알려주면 됩니다.
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const b = await chromium.launch(LAUNCH);
const ctx = await b.newContext({ timezoneId: 'Asia/Seoul' });
const page = await ctx.newPage();
await page.route('**/*', r => {
  const u = r.request().url();
  if (u.startsWith('file:')) return r.continue();
  if (/chart\.js|lucide|pretendard|firebase/.test(u)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.Chart=function(){this.destroy=function(){}};window.lucide={createIcons(){}};' });
  return r.fulfill({ status: 200, body: '' });
});
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(APP);
await page.waitForFunction(() => typeof window.searchFeatures === 'function');

// 습관을 하나 심어둡니다. 빈 상태에서만 도는 코드 경로가 있어서요.
await page.evaluate(() => {
  const T = todayStr(), back = k => { const d = parseYmd(T); d.setDate(d.getDate() - k); return ymd(d); };
  const checked = {}; [1, 2, 3].forEach(k => checked[back(k)] = true);
  localStorage.setItem('ht_habits_v2', JSON.stringify([
    { id: 'h1', name: '운동', createdAt: back(20), checked, category: '건강', timeSlot: '아침', freq: { type: 'daily' }, min: '스쿼트 10개' },
  ]));
});

const out = await page.evaluate(() => {
  const R = [];
  const ok = (n, got, want) => R.push({ n, pass: JSON.stringify(got) === JSON.stringify(want), got, want });
  const yes = (n, cond, got) => R.push({ n, pass: !!cond, got: got || '' });

  // ── 검색이 걸리나 ──
  const find = q => searchFeatures(q).map(f => f.n);
  yes('"분야" → 분야 항목', find('분야').some(n => n.includes('분야')), find('분야').join(', '));
  yes('"생리학" 같은 예시어로도 걸림', find('생리학').some(n => n.includes('분야')), find('생리학').join(', '));
  yes('"최소" → 최소 버전', find('최소').some(n => n.includes('최소 버전')), find('최소').join(', '));
  yes('"이거라도" 로도 걸림', find('이거라도').some(n => n.includes('최소 버전')), '');
  yes('"포모도로" → 집중 모드', find('포모도로').some(n => n.includes('집중 모드')), '');
  yes('"백업" → 데이터 백업', find('백업').some(n => n.includes('백업')), '');
  yes('영어로도 걸림 (todo)', find('todo').length > 0, find('todo').join(', '));
  yes('대문자로 쳐도 걸림 (AI)', find('AI').length > 0, '');
  yes('두 낱말 모두 걸려야 함', find('주간 회고').every(n => true) && find('주간 회고').length > 0, find('주간 회고').join(', '));
  ok('없는 말은 0개', find('zzzzzz').length, 0);
  ok('빈 검색어는 전체', searchFeatures('').length, FEATURES.length);
  ok('공백만 쳐도 전체', searchFeatures('   ').length, FEATURES.length);

  // ── 목록에 빈 칸이 없나 ──
  const bad = FEATURES.filter(f => !f.n || !f.w || !f.d || typeof f.go !== 'function');
  ok('모든 항목에 이름·위치·설명·이동이 있음', bad.map(f => f.n), []);
  const dupes = FEATURES.map(f => f.n).filter((n, i, a) => a.indexOf(n) !== i);
  ok('이름 중복 없음', dupes, []);

  // ── 화면 렌더 ──
  openSearch();
  yes('열면 전체 목록이 보임', document.querySelectorAll('#sc-results .sc-hit').length === FEATURES.length,
      document.querySelectorAll('#sc-results .sc-hit').length);
  document.getElementById('sc-input').value = '분야';
  renderSearch();
  yes('치면 줄어듦', document.querySelectorAll('#sc-results .sc-hit').length < FEATURES.length, '');
  document.getElementById('sc-input').value = 'zzzzzz';
  renderSearch();
  yes('못 찾으면 안내 문구', document.getElementById('sc-results').innerHTML.includes('못 찾았어요'), '');
  closeModal('search-modal');

  return R;
});

// ── 40개 항목을 전부 실제로 눌러본다 ──
// 이게 이 테스트의 핵심이에요. 목록에 적어만 두고 실제로는 못 가는 항목이
// 있으면 검색 기능이 오히려 짜증나는 물건이 되니까요.
const count = await page.evaluate(() => FEATURES.length);
const jumpFails = [];
for (let i = 0; i < count; i++) {
  const before = errs.length;
  const r = await page.evaluate(async (idx) => {
    // 모달을 다 닫고 시작
    document.querySelectorAll('.overlay.open').forEach(o => o.classList.remove('open'));
    const f = FEATURES[idx];
    let err = '';
    try { f.go(); } catch (e) { err = e.message; }
    await new Promise(res => setTimeout(res, 220));
    const openModals = [...document.querySelectorAll('.overlay.open')].map(o => o.id);
    const activeTab = (document.querySelector('.tab.active') || {}).id || '';
    return { name: f.n, err, openModals, activeTab };
  }, i);
  await page.waitForTimeout(60);
  const newErrs = errs.slice(before);
  if (r.err || newErrs.length) jumpFails.push(`${r.name} → ${r.err || newErrs.join(' | ')}`);
  else if (!r.activeTab) jumpFails.push(`${r.name} → 활성 탭이 없어요`);
}

const R = out;
R.push({ n: `${count}개 항목이 전부 실제로 이동됨`, pass: jumpFails.length === 0, got: jumpFails.join('\n      ') });

let bad = 0;
for (const r of R) { if (!r.pass) bad++; console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.n + (r.pass ? '' : `\n      받음: ${typeof r.got === 'string' ? r.got : JSON.stringify(r.got)}${r.want !== undefined ? '  기대: ' + JSON.stringify(r.want) : ''}`)); }
console.log(bad ? `\n${bad}개 실패` : '\n전부 통과');
await b.close();
process.exit(bad ? 1 : 0);
