// 예측 채점(scoreBet / resolveBets) 이 실제 기록과 맞는지 확인
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';

const APP = pathToFileURL(new URL('../index.html', import.meta.url).pathname).href;
// 브라우저 경로: 보통은 playwright 가 알아서 찾아요.
// 특별한 위치에 깔려 있으면 CHROME_PATH 환경변수로 알려주면 됩니다.
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const b = await chromium.launch(LAUNCH);
const ctx = await b.newContext({ timezoneId: 'Asia/Seoul' });
const page = await ctx.newPage();
// CDN 은 막혀 있으니 가짜로 채워둠
await page.route('**/*', r => {
  const u = r.request().url();
  if (u.startsWith('file:')) return r.continue();
  if (/chart\.js|lucide|pretendard|firebase/.test(u)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.Chart=function(){this.destroy=function(){}};window.lucide={createIcons(){}};' });
  return r.fulfill({ status: 200, body: '' });
});
page.on('pageerror', e => console.log('  [pageerror]', e.message));
await page.goto(APP);
await page.waitForFunction(() => typeof window.scoreBet === 'function');

const out = await page.evaluate(() => {
  const R = [];
  const ok = (name, got, want) => R.push({ name, pass: JSON.stringify(got) === JSON.stringify(want), got, want });

  const days = (from, n) => { const a = []; const d = parseYmd(from); for (let i = 0; i < n; i++) { a.push(ymd(d)); d.setDate(d.getDate() + 1); } return a; };
  const T = todayStr();
  const back = n => { const d = parseYmd(T); d.setDate(d.getDate() - n); return ymd(d); };

  // 매일 습관: 30일 전 생성, 예측은 20일 전에 걸었고 기한은 5일 전
  const mk = pattern => {
    const checked = {};
    days(back(29), 30).forEach((ds, i) => { if (pattern[i]) checked[ds] = true; });
    return { id: 'h1', name: '운동', createdAt: back(29), checked, freq: { type: 'daily' } };
  };

  // 1) streak — 예측 구간(19일전~5일전) 안에서 10일 연속을 찍었나?
  //    앞 10일 아무것도 안 함, 그 뒤 20일 전부 함 → 구간 안 최고 연속은 넉넉히 10 이상
  const h1 = mk([...Array(10).fill(0), ...Array(20).fill(1)]);
  const bet1 = { madeAt: back(20), dueAt: back(5), kind: 'streak', n: 10 };
  ok('streak 달성', scoreBet(bet1, h1).hit, true);
  ok('streak 과욕(30일)', scoreBet({ ...bet1, n: 30 }, h1).hit, false);

  // 2) rate — 구간 15일 중 전부 성공 → 100%
  ok('rate 100%', scoreBet({ madeAt: back(20), dueAt: back(5), kind: 'rate', n: 80 }, h1).hit, true);
  ok('rate 미달 판정', scoreBet({ madeAt: back(20), dueAt: back(5), kind: 'rate', n: 101 }, h1).hit, false);

  // 3) break — 구간 안에 3일 이상 빈 적이 있나?
  //    처음 20일은 함, 이후 10일 쉼
  const h2 = mk([...Array(20).fill(1), ...Array(10).fill(0)]);
  ok('break 발생', scoreBet({ madeAt: back(15), dueAt: back(1), kind: 'break', n: 3 }, h2).hit, true);
  ok('break 없음(꾸준할 때)', scoreBet({ madeAt: back(20), dueAt: back(5), kind: 'break', n: 3 }, h1).hit, false);

  // 4) 구간 밖 기록은 세지 않는다 — 예측 이전의 연속은 카운트에 이어지되
  //    "구간 안에 아무 판정 단위도 없으면" null
  ok('판정 불가 → null', scoreBet({ madeAt: T, dueAt: T, kind: 'rate', n: 50 }, h1), null);

  // 5) resolveBets — 기한 지난 건 채점, 안 지난 건 그대로
  localStorage.setItem('ht_habits_v2', JSON.stringify([h1]));
  localStorage.setItem('ht_forecast_v1', JSON.stringify({ bets: [
    { id: 'a', madeAt: back(20), dueAt: back(5), habitId: 'h1', habit: '운동', kind: 'streak', n: 10, days: 15, say: '10일 연속', result: null },
    { id: 'b', madeAt: back(20), dueAt: back(5), habitId: 'h1', habit: '운동', kind: 'streak', n: 30, days: 15, say: '30일 연속', result: null },
    { id: 'c', madeAt: T, dueAt: (()=>{const d=parseYmd(T); d.setDate(d.getDate()+10); return ymd(d);})(), habitId: 'h1', habit: '운동', kind: 'rate', n: 70, days: 10, say: '앞으로 70%', result: null },
    { id: 'd', madeAt: back(20), dueAt: back(5), habitId: 'zzz', habit: '사라진습관', kind: 'streak', n: 5, days: 15, say: 'x', result: null },
  ] }));
  const fc = resolveBets();
  ok('채점: 맞음', fc.bets[0].result, 'hit');
  ok('채점: 빗나감', fc.bets[1].result, 'miss');
  ok('기한 전은 안 건드림', fc.bets[2].result, null);
  ok('삭제된 습관 → void', fc.bets[3].result, 'void');

  // 6) saveBet — 채점 안 된 옛 예측은 정리되고 새 것만 남음
  saveBet({ habit: '운동', kind: 'streak', n: 21, days: 14, say: '21일 연속 찍을 것 같아요' }, [h1]);
  const fc2 = loadForecast();
  ok('새 예측 저장됨', fc2.bets[fc2.bets.length - 1].say, '21일 연속 찍을 것 같아요');
  ok('미채점 옛 예측 정리됨', fc2.bets.filter(x => !x.result && x.id === 'c').length, 0);
  ok('채점된 건 남음', fc2.bets.filter(x => x.result === 'hit').length, 1);

  // 7) 화면 렌더가 터지지 않나
  let err = '';
  try { renderBets(); } catch (e) { err = e.message; }
  ok('renderBets 정상', err, '');
  R.push({ name: 'renderBets 내용', pass: document.getElementById('pred-bets').innerHTML.includes('21일 연속'), got: document.getElementById('pred-bets').innerHTML.slice(0, 80) });

  // 8) habitPeriods 리팩터링 후에도 기존 계산이 같은가
  ok('successRate 유지', successRate(h1), 67);   // 30개 중 20개 (마지막 진행중 제외 안 됨: 오늘 체크됨)
  ok('maxStreak 유지', maxStreak(h1), 20);

  return R;
});

let bad = 0;
for (const r of out) { if (!r.pass) bad++; console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.name + (r.pass ? '' : `\n      받음: ${JSON.stringify(r.got)}  기대: ${JSON.stringify(r.want)}`)); }
console.log(bad ? `\n${bad}개 실패` : '\n전부 통과');
await b.close();
process.exit(bad ? 1 : 0);
