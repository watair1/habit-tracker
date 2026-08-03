// ────────────────────────────────────────────────────────────
//  index.html 자가 점검 스크립트
//
//  실행:  node check.mjs
//
//  코드가 파일 하나에 다 들어 있어서, 이름이 겹치거나 onclick 이 부르는
//  함수를 안 만들었으면 앱 전체가 안 뜨는데 브라우저를 열기 전엔 몰라요.
//  저장한 뒤 이걸 한 번 돌리면 바로 잡힙니다.
// ────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);

let problems = 0;
const fail = (msg) => { problems++; console.log('  ✗ ' + msg); };
const pass = (msg) => console.log('  ✓ ' + msg);

// ── 1. 문법 ────────────────────────────────────────────────
// 같은 이름을 const/let 으로 두 번 선언하는 사고도 여기서 같이 잡혀요
// (자바스크립트가 파싱 단계에서 SyntaxError 를 내기 때문).
console.log('\n[1] 문법 / 이름 중복 선언');
let syntaxOk = true;
blocks.forEach((code, i) => {
  try { new Function(code); }
  catch (e) { syntaxOk = false; fail(`script 블록 ${i + 1}: ${e.message}`); }
});
if (syntaxOk) pass(`script 블록 ${blocks.length}개 모두 정상`);

// ── 2. HTML 에서 부르는 함수가 실제로 있는지 ───────────────
// onclick="foo()" 라고 써놓고 foo 를 안 만들면 눌러야만 알게 돼요.
console.log('\n[2] onclick 등에서 부르는 함수');

// 최상위(들여쓰기 없음) 선언만 수집 — 템플릿 문자열 안쪽은 들여쓰기가 있어서 걸리지 않음
const defined = new Set();
blocks.forEach(code => {
  for (const m of code.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) defined.add(m[1]);
  for (const m of code.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm)) defined.add(m[1]);
});

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function']);
const called = new Map();   // 이름 → 어떤 속성에서 불렸는지
for (const m of html.matchAll(/\son(click|change|input|keydown|submit)\s*=\s*"([^"]*)"/g)) {
  // 앞에 점이 없는 호출만 = 전역 함수 호출 (event.stopPropagation() 같은 메서드는 제외)
  for (const c of m[2].matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (!KEYWORDS.has(c[1])) called.set(c[1], m[1]);
  }
}
const missing = [...called].filter(([n]) => !defined.has(n));
if (missing.length) missing.forEach(([n, attr]) => fail(`on${attr} 에서 '${n}()' 을 부르는데 정의가 없어요`));
else pass(`HTML 이 부르는 함수 ${called.size}개 전부 정의됨 (전역 선언 ${defined.size}개)`);

// ── 3. 날짜를 UTC 로 다루는 실수 ───────────────────────────
// toISOString().slice(0,10) 은 UTC 기준이라 한국에선 새벽에 날짜가 하루 밀려요.
console.log('\n[3] 날짜 처리');
// 주석은 빼고 검사 (설명문에 적힌 예시가 걸리지 않게)
const codeOnly = blocks.join('\n').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const utc = codeOnly.match(/toISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*10\s*\)/g);
if (utc) fail(`toISOString().slice(0,10) 이 ${utc.length}곳 있어요 — ymd() 를 쓰세요`);
else pass('날짜 문자열을 전부 ymd() 로 만들고 있음');

// ── 4. API 키가 코드에 박혀 있지 않은지 ────────────────────
console.log('\n[4] 비밀값 노출');
const secrets = [
  [/AIza[0-9A-Za-z_-]{30,}/g, 'Google/Gemini API 키'],
  [/sk-ant-[0-9A-Za-z_-]{20,}/g, 'Anthropic API 키'],
];
let leaked = false;
for (const [re, what] of secrets) {
  // 첫 매치만 보면 안 돼요. Firebase 설정 키가 파일 앞쪽에 있어서,
  // 뒤에 진짜 키를 박아도 그냥 넘어가 버립니다. 전부 검사합니다.
  for (const m of html.matchAll(re)) {
    const before = html.slice(Math.max(0, m.index - 60), m.index);
    if (/apiKey\s*:/.test(before)) continue;   // Firebase 웹 설정 키는 공개돼도 되는 값 (보안은 Firestore 규칙으로)
    leaked = true;
    fail(`${what} 로 보이는 문자열이 코드에 있어요 — ${m[0].slice(0, 12)}…`);
  }
}
if (!leaked) pass('코드에 박힌 비밀 키 없음');

// ── 결과 ───────────────────────────────────────────────────
console.log('\n' + '─'.repeat(52));
if (problems) {
  console.log(`문제 ${problems}개. 고치고 다시 실행해주세요.\n`);
  process.exit(1);
}
console.log('전부 통과했어요.\n');
