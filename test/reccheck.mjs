// 회복 시스템(두 번은 안 빠진다 + 최소 버전) 확인
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';

const APP = pathToFileURL(new URL('../index.html', import.meta.url).pathname).href;
// 브라우저 경로: 보통은 playwright 가 알아서 찾아요.
// 특별한 위치에 깔려 있으면 CHROME_PATH 환경변수로 알려주면 됩니다.
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const b = await chromium.launch(LAUNCH);

async function run(tz, label) {
  const ctx = await b.newContext({ timezoneId: tz });
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
  await page.waitForFunction(() => typeof window.habitRecovery === 'function');

  const out = await page.evaluate(() => {
    const R = [];
    const ok = (n, got, want) => R.push({ n, pass: JSON.stringify(got) === JSON.stringify(want), got, want });
    const T = todayStr();
    const back = k => { const d = parseYmd(T); d.setDate(d.getDate() - k); return ymd(d); };

    // 매일 습관. daysAgo 배열에 적힌 날짜만 체크된 상태로 만듦 (0 = 오늘)
    const mk = (name, doneOffsets, extra = {}) => {
      const checked = {};
      doneOffsets.forEach(k => { checked[back(k)] = true; });
      return { id: 'h_' + name, name, createdAt: back(20), checked, freq: { type: 'daily' }, ...extra };
    };

    // ── 회복 상태 판정 ──
    ok('멀쩡함(어제까지 다 함)', habitRecovery(mk('a', [...Array(20).keys()].map(k => k + 1))).state, 'ok');
    ok('오늘 이미 함 → ok', habitRecovery(mk('b', [0, 1, 2, 3])).state, 'ok');
    ok('어제 한 번 놓침 → risk', habitRecovery(mk('c', [2, 3, 4, 5])).state, 'risk');
    ok('이틀 놓침 → broken', habitRecovery(mk('d', [3, 4, 5])).state, 'broken');
    ok('놓친 횟수', habitRecovery(mk('e', [5, 6])).missed, 4);
    ok('오늘만 안 함 → risk 아님', habitRecovery(mk('f', [1, 2, 3])).state, 'ok');

    // ── 오늘 해야 하는 날인가 ──
    const wd = new Date().getDay();
    ok('매일 → 항상 해야 함', dueToday({ freq: { type: 'daily' } }), true);
    ok('오늘 요일 포함', dueToday({ freq: { type: 'days', days: [wd] } }), true);
    ok('오늘 요일 제외', dueToday({ freq: { type: 'days', days: [(wd + 1) % 7] } }), false);
    ok('주 N회 → 아무 날이나', dueToday({ freq: { type: 'weekly', times: 3 } }), true);

    // ── 최소 버전이 연속 기록을 이어주는가 ──
    const h = mk('운동', [1, 2, 3, 4], { min: '스쿼트 10개' });
    localStorage.setItem('ht_habits_v2', JSON.stringify([h]));
    localStorage.setItem('ht_user_v2', JSON.stringify({ xp: 0, achievements: [], totalChecks: 0 }));

    const streakBefore = streakCount(loadHabits()[0]);
    toggleMin(0);
    const after = loadHabits()[0];
    ok('최소 버전 저장값', after.checked[T], 'min');
    ok('최소 버전도 연속에 포함', streakCount(after), streakBefore + 1);
    // 습관이 하나뿐이라 '오늘 모든 습관 완료 +20' 보너스가 같이 붙어요
    ok('최소 XP 5 + 하루 보너스 20', loadUser().xp, 25);
    ok('누적 횟수 +1', loadUser().totalChecks, 1);

    // 최소 → 완료로 올리기. XP는 차액만.
    toggle(0);
    ok('완료로 승격됨', loadHabits()[0].checked[T], true);
    // 승격은 차액(완료 15 - 최소 5 = 10)만. 하루 보너스는 다시 주면 안 됨.
    ok('승격은 차액만, 보너스 재지급 없음', loadUser().xp, 35);
    ok('누적 횟수 중복 안 됨', loadUser().totalChecks, 1);

    // 같은 걸 다시 누르면 취소
    toggle(0);
    ok('취소됨', loadHabits()[0].checked[T], undefined);

    // ── 회복 카드 렌더 ──
    localStorage.setItem('ht_habits_v2', JSON.stringify([
      mk('독서', [2, 3, 4], { min: '한 페이지' }),          // 어제 놓침 → risk
      mk('명상', [6, 7]),                                    // 5일 비었음 → broken(빈도 낮추기 제안)
      mk('물마시기', [0, 1, 2]),                             // 오늘 함 → 안 나와야
    ]));
    renderRecovery();
    const html = document.getElementById('recovery-box').innerHTML;
    R.push({ n: '회복 카드에 risk 습관', pass: html.includes('독서'), got: html.slice(0, 60) });
    R.push({ n: 'risk 문구', pass: html.includes('어제 놓쳤어요'), got: '' });
    R.push({ n: 'broken 습관도 표시', pass: html.includes('명상'), got: '' });
    R.push({ n: '빈도 낮추기 버튼', pass: html.includes('빈도 낮추기'), got: '' });
    R.push({ n: '오늘 한 습관은 빠짐', pass: !html.includes('물마시기'), got: '' });
    R.push({ n: '최소 버전 안내 노출', pass: html.includes('한 페이지'), got: '' });

    // 다 해치우면 카드가 사라지는가
    localStorage.setItem('ht_habits_v2', JSON.stringify([mk('독서', [0, 1, 2])]));
    renderRecovery();
    ok('할 게 없으면 카드 없음', document.getElementById('recovery-box').innerHTML, '');

    // ── 모달이 최소 버전을 싣고 내리는가 ──
    localStorage.setItem('ht_habits_v2', JSON.stringify([mk('독서', [1], { min: '한 페이지' })]));
    editHabit(0);
    ok('수정 모달에 최소 버전 채워짐', document.getElementById('m-min').value, '한 페이지');
    document.getElementById('m-min').value = '표지만 보기';
    addHabit();
    ok('최소 버전 수정 저장', loadHabits()[0].min, '표지만 보기');
    openAddModal();
    ok('추가 모달은 비워짐', document.getElementById('m-min').value, '');

    // ── AI 코치의 set_habit_min 액션 ──
    localStorage.setItem('ht_habits_v2', JSON.stringify([mk('산책', [3, 4])]));
    const day = getDay(dayCursor);
    day.chat = [{ role: 'ai', text: '문턱을 낮춰볼게요', actions: [{ type: 'set_habit_min', id: 'h_산책', text: '신발 신고 나가기' }] }];
    setDay(dayCursor, day);
    applyAgentActions(0, null);
    ok('코치가 최소 버전을 넣음', loadHabits()[0].min, '신발 신고 나가기');
    R.push({ n: '액션 설명 문구', pass: agentActionLabel({ type: 'set_habit_min', id: 'h_산책', text: '신발 신고 나가기' }).includes('최소 버전'), got: '' });

    // ── 렌더 전체가 안 터지는가 ──
    let err = '';
    try { render(); renderStats(); renderGoals(); } catch (e) { err = e.message; }
    ok('전체 렌더 정상', err, '');

    return R;
  });

  console.log(`\n[${label}]`);
  let bad = 0;
  for (const r of out) { if (!r.pass) bad++; console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.n + (r.pass ? '' : `\n      받음: ${JSON.stringify(r.got)}  기대: ${JSON.stringify(r.want)}`)); }
  if (errs.length) { console.log('  [pageerror] ' + errs.join(' | ')); bad += errs.length; }
  await ctx.close();
  return bad;
}

let bad = 0;
bad += await run('Asia/Seoul', '서울');
bad += await run('America/New_York', '뉴욕 (음수 시차)');
console.log(bad ? `\n${bad}개 실패` : '\n전부 통과');
await b.close();
process.exit(bad ? 1 : 0);
