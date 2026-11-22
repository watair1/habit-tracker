// 보이는 AI 비서 — "이대로 적용"을 누르면 일마다 그 화면을 찾아가 반영하고, 멈추기·되돌리기가 되는지
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';

const APP = pathToFileURL(new URL('../index.html', import.meta.url).pathname).href;
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const b = await chromium.launch(LAUNCH);

async function open(reducedMotion = 'no-preference') {
  const ctx = await b.newContext({ timezoneId: 'Asia/Seoul', viewport: { width: 412, height: 860 }, reducedMotion });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith('file:')) return r.continue();
    if (/lucide|chart\.js|pretendard|gstatic|firebase/.test(u))
      return r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.lucide={createIcons(){}};window.Chart=function(){this.destroy=function(){}};' });
    return r.fulfill({ status: 200, body: '' });
  });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    const d = new Date(), t = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    localStorage.setItem('ht_habits_v2', JSON.stringify([
      { id:'h1', name:'물', createdAt:t, checked:{}, category:'건강', timeSlot:'자유', freq:null, min:'' },
      { id:'h2', name:'독서', createdAt:t, checked:{}, category:'학습', timeSlot:'저녁', freq:null, min:'' }]));
    localStorage.setItem('ht_user_v2', JSON.stringify({ xp: 0, achievements: [], totalChecks: 0 }));
    localStorage.setItem('ht_goals_v1', JSON.stringify([]));
    const actions = [
      { type:'check_habit', id:'h2' },
      { type:'set_mood', mood:'good' },
      { type:'add_event', title:'운동', start:'15:00', end:'16:00' },
      { type:'add_todo', text:'장보기' },
      { type:'add_goal', title:'책 12권', goalType:'long', targetDate:null } ];
    localStorage.setItem('ht_day_v1', JSON.stringify({ [t]: { todos:[], events:[], chat:[
      { role:'user', text:'해줘' }, { role:'bot', text:'다섯 가지 할게요', actions } ] } }));
  });
  await page.goto(APP);
  await page.waitForFunction(() => typeof window.applyAgentActions === 'function');
  await page.waitForTimeout(300);
  return { page, ctx, errs };
}
const R = []; const ok = (n, got, want) => R.push([n, JSON.stringify(got) === JSON.stringify(want), got, want]);
const state = page => page.evaluate(() => {
  const t = todayStr(), d = getDay(t);
  return { read: !!loadHabits()[1].checked[t], mood: loadMoods()[t] || null, ev: d.events.map(e => e.title),
           todo: d.todos.map(x => x.text), goal: loadGoals().map(g => g.title), applied: !!d.chat[1].applied };
});
const before = { read:false, mood:null, ev:[], todo:[], goal:[], applied:false };

// ── 1. 끝까지 보여주며 처리 ──
{
  const { page, ctx, errs } = await open();
  await page.evaluate(() => openAgent());
  await page.click('#agent-log button:has-text("이대로 적용")');
  ok('조작 중엔 화면 가장자리가 빛남', await page.evaluate(() => $('ag-glow').classList.contains('on')), true);
  ok('조작 중엔 커서가 보임', await page.evaluate(() => $('ag-cursor').classList.contains('on')), true);
  ok('비서 창은 내려감', await page.evaluate(() => $('agent-modal').classList.contains('open')), false);
  // 일정·할 일·기분은 하루 탭, 목표는 목표 탭에 있어서 탭을 넘겨 다녀야 해요
  const tabs = new Set();
  for (let i = 0; i < 60 && !(await page.evaluate(() => $('ag-done').classList.contains('on'))); i++) {
    tabs.add(await page.evaluate(() => document.querySelector('.tab.active').id)); await page.waitForTimeout(250);
  }
  ok('오늘 · 하루 · 목표 탭을 모두 거쳐 감', ['tab-today','tab-day','tab-goals'].every(t => tabs.has(t)), true);
  ok('다섯 가지 다 반영', await state(page), { read:true, mood:'good', ev:['운동'], todo:['장보기'], goal:['책 12권'], applied:true });
  ok('요약 카드: 5개 처리', await page.textContent('#ag-done-title'), '5개 처리했어요');
  ok('끝나면 빛·커서 꺼짐', await page.evaluate(() => [$('ag-glow').classList.contains('on'), $('ag-cursor').classList.contains('on')]), [false, false]);
  await page.click('#ag-done button:has-text("되돌리기")');
  ok('되돌리기 → 적용 전으로', await state(page), before);
  ok('되돌리면 "이대로 적용" 버튼이 다시 살아남', await page.evaluate(() => { openAgent(); return !!document.querySelector('#agent-log button:not([disabled])'); }), true);
  ok('pageerror 없음', errs, []);
  await ctx.close();
}

// ── 2. 중간에 화면을 눌러 멈추고, 여기까지만 ──
{
  const { page, ctx, errs } = await open();
  await page.evaluate(() => openAgent());
  await page.click('#agent-log button:has-text("이대로 적용")');
  await page.waitForFunction(() => getDay(todayStr()).events.length === 0 && loadMoods()[todayStr()] === 'good', null, { timeout: 15000 });
  await page.mouse.click(30, 300);
  ok('화면을 누르면 멈춤 창', await page.isVisible('#ag-stopped'), true);
  const s1 = await state(page);
  await page.waitForTimeout(1200);
  ok('멈춘 동안엔 더 진행 안 함', await state(page), s1);
  await page.click('#ag-stopped button:has-text("여기까지만")');
  await page.waitForFunction(() => $('ag-done').classList.contains('on'), null, { timeout: 5000 });
  const s2 = await state(page);
  ok('여기까지만 → 뒤의 일은 안 함', [s2.read, s2.mood, s2.goal.length], [true, 'good', 0]);
  ok('pageerror 없음 (멈춤)', errs, []);
  await ctx.close();
}

// ── 3. 움직임 줄이기를 켠 사람은 한 번에 ──
{
  const { page, ctx, errs } = await open('reduce');
  await page.evaluate(() => openAgent());
  await page.click('#agent-log button:has-text("이대로 적용")');
  await page.waitForTimeout(300);
  ok('움직임 줄이기: 바로 다 반영', await state(page), { read:true, mood:'good', ev:['운동'], todo:['장보기'], goal:['책 12권'], applied:true });
  ok('움직임 줄이기: 커서 안 나옴', await page.evaluate(() => $('ag-cursor').classList.contains('on')), false);
  ok('pageerror 없음 (줄이기)', errs, []);
  await ctx.close();
}

for (const [n, p, g, w] of R) console.log((p ? '  ✓ ' : '  ✗ ') + n + (p ? '' : `\n      받음: ${JSON.stringify(g)}  기대: ${JSON.stringify(w)}`));
console.log(R.every(a => a[1]) ? '\n전부 통과' : '\n실패 있음');
await b.close();
process.exit(R.every(a => a[1]) ? 0 : 1);
