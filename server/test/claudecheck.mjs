// Claude 연결 — 진짜 키 없이 가짜 클라이언트로 동작만 확인해요
import Anthropic from '@anthropic-ai/sdk';

process.env.AI_PROVIDER = 'claude';
process.env.ANTHROPIC_API_KEY = 'fake';
const { callClaude, _setClientForTest } = await import('../claude.js');
const { callAI } = await import('../llm.js');

let sent = [], replies = [];
_setClientForTest({ beta: { messages: { create: async body => {
  sent.push(body);
  const r = replies.shift();
  if (r instanceof Error) throw r;
  return r;
} } } });
const text = (t, stop = 'end_turn') => ({ stop_reason: stop, content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: t }] });
const fakeErr = cls => Object.assign(Object.create(cls.prototype), { message: cls.name });

const R = []; const ok = (n, c, g) => R.push([n, !!c, g]);
const tryCall = async (...a) => { try { return { v: await callClaude(...a) }; } catch (e) { return { e }; } };

replies = [text('{"reply":"안녕","actions":[]}')];
let r = await tryCall('sys', 'hi', { json: true });
ok('JSON 답을 읽음', r.v && r.v.reply === '안녕', JSON.stringify(r));
const b = sent.at(-1);
ok('모델 claude-sonnet-5-5', b.model === 'claude-sonnet-5-5', b.model);
ok('생각 깊이 low', b.output_config && b.output_config.effort === 'low', JSON.stringify(b.output_config));
ok('거절되면 대신 답하는 폴백 켜짐', b.fallbacks === 'default' && b.betas.includes('server-side-fallback-2026-07-01'), '');
ok('JSON 만 보내라고 지시', /JSON 하나만/.test(b.system), '');
ok('thinking 끄는 옵션 안 보냄 (Sonnet 5.5 는 400)', !('thinking' in b), '');

replies = [text('여기요:\n```json\n{"a":1}\n```')];
r = await tryCall('s', 'u', { json: true });
ok('코드펜스·앞말 섞여도 읽음', r.v && r.v.a === 1, JSON.stringify(r));

replies = [text('죄송'), text('{"ok":true}')];
r = await tryCall('s', 'u', { json: true });
ok('JSON 깨지면 한 번 더 물어봄', r.v && r.v.ok === true && replies.length === 0, JSON.stringify(r));

replies = [text('', 'refusal')];
r = await tryCall('s', 'u', { json: true });
ok('끝내 거절이면 refusal 표시', r.e && r.e.refusal, String(r.e));

replies = [fakeErr(Anthropic.RateLimitError)];
r = await tryCall('s', 'u'); ok('429 → rateLimit', r.e && r.e.rateLimit, '');
replies = [fakeErr(Anthropic.InternalServerError)];
r = await tryCall('s', 'u'); ok('5xx/붐빔 → overloaded', r.e && r.e.overloaded, '');
replies = [fakeErr(Anthropic.APIConnectionTimeoutError)];
r = await tryCall('s', 'u'); ok('시간 초과 → overloaded', r.e && r.e.overloaded, '');
replies = [fakeErr(Anthropic.AuthenticationError)];
r = await tryCall('s', 'u'); ok('키 틀림 → noKey', r.e && r.e.noKey, '');

replies = [text('평문 답')];
r = await tryCall('s', 'u'); ok('json 아니면 글 그대로', r.v === '평문 답', JSON.stringify(r));

// 잠금이 비어 있으면 Claude 를 부르지 않음
process.env.ALLOWED_EMAILS = '';
const n = sent.length;
try { await callAI('s', 'u'); ok('잠금 없으면 막음', false, '통과됨'); }
catch (e) { ok('잠금 없으면 Claude 안 부름', e.locked && sent.length === n, String(e)); }
process.env.ALLOWED_EMAILS = 'me@gmail.com';
replies = [text('네')];
ok('잠금 있으면 Claude 부름', (await callAI('s', 'u')) === '네', '');

for (const [nm, c, g] of R) console.log((c ? '  ✓ ' : '  ✗ ') + nm + (c ? '' : '  받음: ' + g));
console.log(R.every(a => a[1]) ? '\n전부 통과' : '\n실패 있음');
process.exit(R.every(a => a[1]) ? 0 : 1);
