// ────────────────────────────────────────────────────────────
//  AI 엔드포인트 (전부 POST, JSON)
//  goal-to-habits / auto-schedule 출력은 앱 데이터 모델에 바로 넣을 수 있는 형태
// ────────────────────────────────────────────────────────────
import express from 'express';
import { callGemini } from '../gemini.js';

const router = express.Router();

// 앱과 맞춰야 하는 enum
const CATEGORIES = ['건강', '학습', '마음', '생활', '관계', '재정'];
const TIMESLOTS = ['아침', '오전', '점심', '오후', '저녁', '자유'];
const MOODS = ['worst', 'bad', 'neutral', 'good', 'best'];
const GOAL_TYPES = ['long', 'mid', 'short'];
const TODO_STATUS = ['o', 'partial', 'x', 'none'];

// 필수 필드 검사 헬퍼
function need(res, cond, msg) {
  if (!cond) { res.status(400).json({ error: 'BAD_REQUEST', message: msg }); return false; }
  return true;
}

// 에러를 한국어 응답으로 변환
function fail(res, err) {
  if (err && err.noKey) return res.status(500).json({ error: 'NO_KEY', message: '서버에 API 키가 설정되지 않았어요. 관리자에게 문의하세요.' });
  if (err && err.rateLimit) return res.status(429).json({ error: 'RATE_LIMIT', message: 'AI 사용 한도에 걸렸어요. 1분쯤 뒤에 다시 해보고, 계속 그러면 하루 한도일 수 있어요.' });
  if (err && err.overloaded) return res.status(503).json({ error: 'OVERLOADED', message: 'AI 서버가 잠시 붐벼요. 조금 뒤에 다시 시도해주세요.' });
  console.error('[AI error]', err && err.message);
  return res.status(500).json({ error: 'AI_ERROR', message: 'AI 요청에 실패했어요. 잠시 후 다시 시도해주세요.' });
}

// HH:MM 을 30분 스냅 + 유효 범위로 정리
function snapTime(s) {
  if (typeof s !== 'string' || !/^\d{1,2}:\d{2}$/.test(s)) return null;
  let [h, m] = s.split(':').map(Number);
  let total = Math.round((h * 60 + m) / 30) * 30;
  total = Math.max(0, Math.min(1440, total));
  const hh = Math.floor(total / 60), mm = total % 60;
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

// ── 1. 자연어 → 습관 파싱 ─────────────────────────────────
router.post('/parse-habit', async (req, res) => {
  const { text } = req.body || {};
  if (!need(res, text && text.trim(), '무엇을 습관으로 만들지 적어주세요.')) return;
  try {
    const sys = `너는 한국어 습관 파서다. 사용자의 자연어에서 습관들을 추출해라.
반드시 JSON 배열만 출력한다: [{"habit":"습관이름","time":"HH:MM 또는 null","days":["월","화"...] 또는 []}]
- habit은 짧고 실행 가능한 문장.
- 시간이 명시 안 됐으면 time은 null.
- 요일이 명시 안 됐으면 days는 빈 배열 [].`;
    const out = await callGemini(sys, `문장: ${text}`, { json: true });
    res.json(Array.isArray(out) ? out : (out.habits || []));
  } catch (e) { fail(res, e); }
});

// ── 2. 주간 리포트 ────────────────────────────────────────
router.post('/weekly-report', async (req, res) => {
  const { habits, weekStart } = req.body || {};
  if (!need(res, Array.isArray(habits), '습관 데이터(habits 배열)가 필요해요.')) return;
  try {
    const sys = `너는 따뜻한 습관 코치다. 지난 한 주 습관 기록을 보고 원인 분석과 격려를 해라.
반드시 JSON만 출력: {"analysis":"이번 주 패턴과 원인 분석 (2~3문장, 한국어)","encouragement":"짧은 격려 한 줄"}`;
    const user = `주 시작: ${weekStart || '이번 주'}\n습관별 체크한 날짜:\n` +
      habits.map(h => `- ${h.name}: ${(h.checkedDates || []).join(', ') || '기록 없음'}`).join('\n');
    const out = await callGemini(sys, user, { json: true });
    res.json({ analysis: out.analysis || '', encouragement: out.encouragement || '' });
  } catch (e) { fail(res, e); }
});

// ── 3. 습관 구체화 ────────────────────────────────────────
router.post('/refine-habit', async (req, res) => {
  const { habitName } = req.body || {};
  if (!need(res, habitName && habitName.trim(), '구체화할 습관 이름이 필요해요.')) return;
  try {
    const sys = `너는 습관 설계 전문가다. 모호한 습관을 "언제/얼마나/어떻게"가 담긴 구체적 행동 문장으로 바꿔라.
반드시 JSON만 출력: {"refined":"구체적인 습관 문장","reason":"왜 이렇게 바꿨는지 한 줄"}`;
    const out = await callGemini(sys, `습관: ${habitName}`, { json: true });
    res.json({ refined: out.refined || habitName, reason: out.reason || '' });
  } catch (e) { fail(res, e); }
});

// ── 4. 목표 → 실천 습관 3~5개 분해 ────────────────────────
router.post('/goal-to-habits', async (req, res) => {
  const { goal } = req.body || {};
  if (!need(res, goal && goal.trim(), '목표를 적어주세요.')) return;
  try {
    const sys = `너는 목표를 실천 습관으로 쪼개는 코치다. 목표 달성에 필요한 습관 3~5개를 제안해라.
반드시 JSON 배열만 출력: [{"habit":"습관 문장","category":"카테고리","timeSlot":"시간대"}]
category는 정확히 이 중 하나: ${CATEGORIES.join(', ')}
timeSlot은 정확히 이 중 하나: ${TIMESLOTS.join(', ')}`;
    let out = await callGemini(sys, `목표: ${goal}`, { json: true });
    if (!Array.isArray(out)) out = out.habits || [];
    // enum 보정
    out = out.slice(0, 5).map(h => ({
      habit: String(h.habit || '').slice(0, 40),
      category: CATEGORIES.includes(h.category) ? h.category : '생활',
      timeSlot: TIMESLOTS.includes(h.timeSlot) ? h.timeSlot : '자유',
    })).filter(h => h.habit);
    res.json(out);
  } catch (e) { fail(res, e); }
});

// ── 5. 실패 패턴 분석 ─────────────────────────────────────
router.post('/failure-analysis', async (req, res) => {
  const { habits } = req.body || {};
  if (!need(res, Array.isArray(habits), '습관 데이터(habits 배열)가 필요해요.')) return;
  try {
    const sys = `너는 데이터 기반 습관 분석가다. 어떤 습관이 왜 자주 실패하는지 패턴을 찾고 맞춤 조언을 해라.
반드시 JSON만 출력: {"patterns":["발견한 패턴 문장", ...],"advice":"실천 가능한 맞춤 조언 (2~3문장)"}`;
    const user = habits.map(h =>
      `- ${h.name} (${h.timeSlot || '자유'}): 체크한 날 ${(h.checkedDates || []).length}일 [${(h.checkedDates || []).join(', ')}]`
    ).join('\n');
    const out = await callGemini(sys, user, { json: true });
    res.json({ patterns: Array.isArray(out.patterns) ? out.patterns : [], advice: out.advice || '' });
  } catch (e) { fail(res, e); }
});

// ── 6. 하루 회고 한 줄 총평 ───────────────────────────────
router.post('/day-summary', async (req, res) => {
  const { date, mood, memo, doneRate, habits, sleepHours } = req.body || {};
  try {
    const sys = `너는 다정한 하루 코치다. 사용자의 하루 데이터를 보고 따뜻한 한 줄 총평을 한국어로 해라.
반드시 JSON만 출력: {"summary":"따뜻하고 구체적인 한 줄 총평"}`;
    const moodTxt = ['', '많이 힘듦', '조금 지침', '보통', '괜찮음', '아주 좋음'][mood] || '기록 없음';
    const sleepTxt = (sleepHours || sleepHours === 0) ? `${sleepHours}시간` : '기록 없음';
    const user = `날짜: ${date || ''}\n기분: ${moodTxt}\n수면: ${sleepTxt}\n실행률: ${doneRate ?? '-'}%\n메모: ${memo || '(없음)'}\n습관: ${(habits || []).map(h => `${h.name}(${h.done ? '완료' : '미완'})`).join(', ') || '없음'}`;
    const out = await callGemini(sys, user, { json: true });
    res.json({ summary: out.summary || '' });
  } catch (e) { fail(res, e); }
});

// ── 7. 자연어 → 하루 일정표 초안 ──────────────────────────
router.post('/auto-schedule', async (req, res) => {
  const { text, date, existingEvents } = req.body || {};
  if (!need(res, text && text.trim(), '어떤 하루를 보낼지 적어주세요.')) return;
  try {
    const sys = `너는 하루 일정 플래너다. 자연어 설명을 시간표로 만들어라.
반드시 JSON 배열만 출력: [{"title":"일정 제목","start":"HH:MM","end":"HH:MM"}]
- 시간은 24시간제 HH:MM, 30분 단위로.
- 이미 있는 일정과 시간이 겹치지 않게 배치.
- 현실적인 순서와 소요시간으로.`;
    const exist = (existingEvents || []).map(e => `${e.start}~${e.end} ${e.title}`).join(', ') || '없음';
    const user = `날짜: ${date || ''}\n이미 있는 일정: ${exist}\n요청: ${text}`;
    let out = await callGemini(sys, user, { json: true });
    if (!Array.isArray(out)) out = out.events || [];
    // 시간 스냅 + 검증
    out = out.map(e => {
      const start = snapTime(e.start), end = snapTime(e.end);
      if (!start || !end) return null;
      return { title: String(e.title || '일정').slice(0, 40), start, end };
    }).filter(Boolean);
    res.json(out);
  } catch (e) { fail(res, e); }
});

// ── 8. 앱 비서 (에이전트: 대화 → 답변 + 실행 액션) ────────
//  하루(일정/할일/하이라이트/기분/수면/메모)뿐 아니라
//  습관·목표·아이디어 메모까지 앱 전체를 다룰 수 있음.
router.post('/day-agent', async (req, res) => {
  const { message, date, events, todos, habits, goals, finalGoal, mood, sleep, dayMemo, history, highlight, mode } = req.body || {};
  if (!need(res, message && message.trim(), '무엇을 도와드릴까요? 메시지를 입력해주세요.')) return;
  try {
    // AI가 없는 항목을 지어내지 못하게, 실제로 보낸 id만 허용
    const evIds = new Set((events || []).map(e => e.id).filter(Boolean));
    const todoIds = new Set((todos || []).map(t => t.id).filter(Boolean));
    const habitIds = new Set((habits || []).map(h => h.id).filter(Boolean));
    const goalIds = new Set((goals || []).map(g => g.id).filter(Boolean));

    // 사용자가 고른 모드에 따라 성격이 달라져요.
    //  coach — 이유를 설명하고 먼저 제안 (기본값)
    //  plain — 시킨 것만 짧게 처리. 조용히 쓰고 싶을 때.
    const isPlain = mode === 'plain';

    const persona = isPlain
      ? `너는 습관 트래커 앱의 비서다. 사용자가 시킨 것만 정확히 처리한다.
답변은 한두 문장으로 짧게. 묻지 않은 조언이나 제안은 절대 하지 마라.
요청이 모호할 때만 짧게 되물어라.`
      : `너는 습관 트래커 앱의 코치다. 단순히 시키는 대로 넣어주는 비서가 아니라,
사용자가 실제로 실행하게 만드는 것이 목표다. 아래 "미루기 방정식"을 늘 염두에 두어라.

  실행할 마음 = (해낼 수 있다는 기대 × 그 일의 가치) / (딴짓 충동 × 보상까지의 지연)

그래서 이렇게 움직여라.
1. 크고 막막한 일은 쪼개라. "리포트 쓰기" 같은 요청이 오면 25~30분 안에 끝낼 수 있는
   단계 여러 개로 나눠 add_todo 를 여러 개 만들어라. 각 단계는 무엇을 하면 끝인지 분명해야 한다.
2. 목표는 지킬 수 있는 크기로 낮춰라. 성공률이 낮은 습관이 보이면 (아래 목록에 성공률이 있다)
   먼저 알려주고 빈도를 줄이자고 제안해라. "매일 운동"보다 지켜지는 "주 3회 운동"이 낫다.
3. 보상을 정하게 도와라. 오늘 가장 중요한 일에는 "끝내면 무엇을 할지"를 함께 정하자고 권해라.
   보상은 거창할 필요 없다 (좋아하는 영상 보기, 아이스크림 하나).
4. 시간을 붙여라. 막연한 할 일보다 "몇 시에 몇 분 동안"이 정해진 일이 실행된다.
   일정을 만들 땐 여유를 너무 길게 잡지 말고 타이트하게 잡아라.
5. 한 번에 하나만. 지금 무엇부터 할지 물으면 여러 개를 나열하지 말고 하나를 골라 이유와 함께 제시해라.

말투: 친근한 한국어 존댓말. 필요한 만큼 충분히 설명하되 장황하지 않게
(보통 2~4문장, 쪼개기나 분석처럼 설명이 필요하면 더 길어져도 된다).
숫자를 근거로 말해라 ("성공률 20%라 부담이 큰 것 같아요"). 훈계하거나 다그치지 마라.`;

    const sys = `${persona}

반드시 JSON만 출력: {"reply":"사용자에게 할 말","actions":[ ... ]}

[일정] (하루 타임라인)
- {"type":"add_event","title":"제목","start":"HH:MM","end":"HH:MM"}  // 24시간제, 30분 단위, 기존 일정과 겹치지 않게
- {"type":"edit_event","id":"기존 일정 id","title":"새 제목"(선택),"start":"HH:MM"(선택),"end":"HH:MM"(선택)}
- {"type":"delete_event","id":"기존 일정 id"}

[할 일]
- {"type":"add_todo","text":"할 일","time":"HH:MM" 또는 null}
  ※ 큰 일을 쪼갤 땐 add_todo 를 여러 개 만들어라. 각 단계는 25~30분 안에 끝낼 수 있고,
     "무엇을 하면 이 단계가 끝인지"가 분명해야 한다.
     나쁨: "리포트 쓰기" / 좋음: "참고자료 3개 찾아 링크 모으기", "목차 5줄 잡기", "서론 한 문단 쓰기"
     순서대로 번호를 붙이지 말고(1. 2. 3.) 내용만 적어라. 시간을 정할 수 있으면 time 도 채워라.
- {"type":"set_todo_status","id":"기존 할일 id","status":"o|partial|x|none"}  // o=완료, partial=부분완료, x=미완료, none=표시 지움
- {"type":"delete_todo","id":"기존 할일 id"}

[습관]
- {"type":"add_habit","name":"습관 이름","category":"${CATEGORIES.join('|')}","timeSlot":"${TIMESLOTS.join('|')}"}
- {"type":"check_habit","id":"기존 습관 id"}    // 오늘 완료로 체크 (XP 획득)
- {"type":"uncheck_habit","id":"기존 습관 id"}  // 체크 해제
- {"type":"delete_habit","id":"기존 습관 id"}   // 습관 자체를 삭제 (기록도 사라짐)

[하루 기록]
- {"type":"set_highlight","text":"오늘 가장 중요한 일"}
- {"type":"set_mood","mood":"${MOODS.join('|')}"}   // worst=최악 … best=최고
- {"type":"set_sleep","bed":"HH:MM","wake":"HH:MM"}
- {"type":"set_day_memo","text":"그날 회고 메모"}

[목표 · 아이디어]
- {"type":"add_goal","title":"목표","goalType":"${GOAL_TYPES.join('|')}","targetDate":"YYYY-MM-DD" 또는 null}  // long=6개월+, mid=1~3개월, short=1~4주
- {"type":"delete_goal","id":"기존 목표 id"}
- {"type":"set_final_goal","title":"인생 최종 목표","desc":"설명" 또는 null}
- {"type":"add_memo","text":"아이디어 메모 내용"}

규칙:
- 아래 "지난 대화"를 반드시 읽어라. 사용자가 "저기 있는 것들", "아까 그거", "나머지" 처럼 앞을 가리키면 지난 대화에서 무엇을 말하는지 찾아 그대로 처리해라. 이미 답을 들은 것을 다시 묻지 마라.
- 기존 항목(일정/할일/습관/목표)을 가리키면 아래 목록에서 id를 찾아 써라. 목록에 없는 id는 절대 만들어내지 마라.
- 가리키는 항목을 목록에서 찾을 수 없으면 actions는 [] 로 두고 reply로 어떤 것인지 되물어라.
- delete_habit / delete_goal 은 기록이 사라지는 위험한 동작이다. 사용자가 "삭제"를 분명히 말했을 때만 써라.
- 조언·질문("뭐부터 할까?", "이번 주 어땠어?")이면 actions는 [] 로 두고 reply로만 답하라.
- 요청이 모호하면 actions는 [] 로 두고 reply로 짧게 되물어라.
${isPlain ? '- 묻지 않은 제안이나 조언은 하지 마라. 요청한 것만 처리하고 끝내라.'
: `- 요청을 처리한 뒤, 도움이 될 만한 것이 눈에 띄면 한 가지만 덧붙여 제안해라
  (성공률이 낮은 습관, 보상이 비어 있는 하이라이트, 너무 큰 할 일 등).
  단 제안은 한 번에 하나까지다. 여러 개를 늘어놓거나 매번 잔소리하지 마라.`}
- reply는 항상 채운다.`;

    // 지난 대화를 프롬프트에 같이 실어요. 이게 없으면 매 요청이 첫 대화처럼 처리돼서
    // "아까 준 목록" 같은 걸 못 알아듣고 계속 되묻게 됩니다.
    const past = (Array.isArray(history) ? history : [])
      .slice(-10)
      .map(m => `${m && m.role === 'bot' ? '비서' : '사용자'}: ${String((m && m.text) || '').slice(0, 400)}`)
      .join('\n');

    const ctx = `${past ? `[지난 대화]\n${past}\n\n` : ''}오늘 날짜: ${date || ''}
현재 일정 (id: 시간 제목): ${(events || []).map(e => `${e.id}: ${e.start}~${e.end} ${e.title}`).join(', ') || '없음'}
할 일 (id: 내용 [상태]): ${(todos || []).map(t => `${t.id}: ${t.text} [${t.status || '미표시'}]`).join(', ') || '없음'}
습관 (id: 이름 (분류/시간대/빈도) 성공률 [오늘]): ${(habits || []).map(h => `${h.id}: ${h.name} (${h.category || '기타'}/${h.timeSlot || '자유'}/${h.freq || '매일'}) 성공률 ${h.successRate ?? '-'}% [${h.doneToday ? '완료' : '미완'}]`).join(', ') || '없음'}
오늘의 하이라이트: ${highlight && highlight.text ? `${highlight.text}${highlight.done ? ' (완료)' : ''} / 보상: ${highlight.reward || '아직 없음'}` : '미설정'}
목표 (id: 제목 (기간)): ${(goals || []).map(g => `${g.id}: ${g.title} (${g.type || ''})`).join(', ') || '없음'}
최종 목표: ${finalGoal ? finalGoal.title : '미설정'}
오늘 기분: ${mood || '기록 없음'}
오늘 수면: ${sleep && sleep.bed ? `${sleep.bed}~${sleep.wake || '?'}` : '기록 없음'}
오늘 회고 메모: ${dayMemo || '없음'}

사용자 메시지: ${message}`;

    const out = await callGemini(sys, ctx, { json: true });
    const actions = sanitizeAgentActions(out.actions, { evIds, todoIds, habitIds, goalIds });
    res.json({ reply: out.reply || '', actions });
  } catch (e) { fail(res, e); }
});

/**
 * AI가 돌려준 액션 목록을 앱에 넣어도 안전한 형태로만 걸러낸다.
 * - 모르는 액션 종류, 잘못된 enum, 시간 형식이 아닌 값은 버림
 * - 기존 항목을 가리키는 id는 실제로 요청에 담겨 온 것만 허용 (AI가 지어낸 id 차단)
 * @param {any} rawActions - 모델이 만든 actions 배열
 * @param {{evIds:Set,todoIds:Set,habitIds:Set,goalIds:Set}} ids - 허용된 id 집합
 * @returns {object[]} 안전하게 정제된 액션 배열
 */
export function sanitizeAgentActions(rawActions, ids) {
  const { evIds, todoIds, habitIds, goalIds } = ids;
  return (Array.isArray(rawActions) ? rawActions : []).map(a => {
      if (!a || typeof a !== 'object') return null;
      const idOk = (set) => typeof a.id === 'string' && set.has(a.id);
      switch (a.type) {
        case 'add_event': {
          const start = snapTime(a.start), end = snapTime(a.end);
          if (!start || !end) return null;
          return { type: 'add_event', title: String(a.title || '일정').slice(0, 40), start, end };
        }
        case 'edit_event': {
          if (!idOk(evIds)) return null;
          const patch = { type: 'edit_event', id: a.id };
          if (a.title != null) patch.title = String(a.title).slice(0, 40);
          if (a.start != null) { const s = snapTime(a.start); if (s) patch.start = s; }
          if (a.end != null) { const e = snapTime(a.end); if (e) patch.end = e; }
          if (patch.title === undefined && patch.start === undefined && patch.end === undefined) return null;
          return patch;
        }
        case 'delete_event':
          return idOk(evIds) ? { type: 'delete_event', id: a.id } : null;

        case 'add_todo': {
          const text = String(a.text || '').slice(0, 60);
          return text ? { type: 'add_todo', text, time: snapTime(a.time) || null } : null;
        }
        case 'set_todo_status':
          if (!idOk(todoIds) || !TODO_STATUS.includes(a.status)) return null;
          return { type: 'set_todo_status', id: a.id, status: a.status };
        case 'delete_todo':
          return idOk(todoIds) ? { type: 'delete_todo', id: a.id } : null;

        case 'add_habit': {
          const name = String(a.name || '').slice(0, 30);
          if (!name) return null;
          return {
            type: 'add_habit', name,
            category: CATEGORIES.includes(a.category) ? a.category : '생활',
            timeSlot: TIMESLOTS.includes(a.timeSlot) ? a.timeSlot : '자유',
          };
        }
        case 'check_habit':
          return idOk(habitIds) ? { type: 'check_habit', id: a.id } : null;
        case 'uncheck_habit':
          return idOk(habitIds) ? { type: 'uncheck_habit', id: a.id } : null;
        case 'delete_habit':
          return idOk(habitIds) ? { type: 'delete_habit', id: a.id } : null;

        case 'set_highlight': {
          const text = String(a.text || '').slice(0, 60);
          return text ? { type: 'set_highlight', text } : null;
        }
        case 'set_mood':
          return MOODS.includes(a.mood) ? { type: 'set_mood', mood: a.mood } : null;
        case 'set_sleep': {
          const bed = snapTime(a.bed), wake = snapTime(a.wake);
          if (!bed && !wake) return null;
          return { type: 'set_sleep', bed, wake };
        }
        case 'set_day_memo':
          return { type: 'set_day_memo', text: String(a.text || '').slice(0, 500) };

        case 'add_goal': {
          const title = String(a.title || '').slice(0, 60);
          if (!title) return null;
          const date = typeof a.targetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.targetDate) ? a.targetDate : null;
          return {
            type: 'add_goal', title,
            goalType: GOAL_TYPES.includes(a.goalType) ? a.goalType : 'short',
            targetDate: date,
          };
        }
        case 'delete_goal':
          return idOk(goalIds) ? { type: 'delete_goal', id: a.id } : null;
        case 'set_final_goal': {
          const title = String(a.title || '').slice(0, 60);
          if (!title) return null;
          return { type: 'set_final_goal', title, desc: a.desc ? String(a.desc).slice(0, 200) : '' };
        }
        case 'add_memo': {
          const text = String(a.text || '').slice(0, 500);
          return text ? { type: 'add_memo', text } : null;
        }
        default:
          return null;
      }
    }).filter(Boolean);
}

export default router;
