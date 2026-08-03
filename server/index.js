// ────────────────────────────────────────────────────────────
//  해빗 트래커 AI 중계 서버 (Express)
//  - DB 없음(무상태 프록시). 데이터 저장은 앱이 담당.
//  - Gemini API 키를 프론트에 노출하지 않기 위한 중계 역할.
// ────────────────────────────────────────────────────────────
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import aiRoutes from './routes/ai.js';

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);            // Render 같은 호스팅 뒤에서 진짜 접속 IP를 읽기 위해

// ── 어디서 호출할 수 있게 할지 (CORS) ──────────────────────
// 예전엔 cors()로 "아무 사이트나 허용"이었어요. 서버 주소가 index.html에 적혀 있으니
// 누구든 자기 페이지에서 이 서버를 불러 내 Gemini 한도를 대신 태울 수 있었죠.
// .env의 ALLOWED_ORIGINS(쉼표로 구분)에 적힌 곳만 허용합니다. 비워두면 전부 허용(개발용).
const ALLOWED = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);          // 앱에서 직접 열기, curl 등
    if (!ALLOWED.length) return cb(null, true);  // 설정 안 했으면 개발 중으로 보고 허용
    cb(null, ALLOWED.includes(origin));
  },
}));
app.use(express.json({ limit: '100kb' }));

// ── 호출 횟수 제한 ────────────────────────────────────────
// Gemini 무료 한도를 남이 대신 소진하는 걸 막는 최소 장치예요.
// 라이브러리 없이 메모리에만 기록합니다(서버를 다시 켜면 초기화).
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = Number(process.env.RATE_LIMIT_PER_MIN || 12);   // IP당 분당 요청 수
const DAILY_MAX = Number(process.env.RATE_LIMIT_PER_DAY || 300); // 서버 전체 하루 요청 수
const hits = new Map();                 // ip → 최근 요청 시각들
let dayCount = 0, dayStamp = new Date().toDateString();

function rateLimit(req, res, next) {
  const today = new Date().toDateString();
  if (today !== dayStamp) { dayStamp = today; dayCount = 0; }   // 날짜 바뀌면 리셋
  if (dayCount >= DAILY_MAX) {
    return res.status(429).json({ error: 'RATE_LIMIT', message: '오늘 이 서버의 AI 사용량을 다 썼어요. 내일 다시 시도해주세요.' });
  }
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    return res.status(429).json({ error: 'RATE_LIMIT', message: '잠깐만요, 요청이 너무 빨라요. 1분 뒤에 다시 시도해주세요.' });
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();   // 메모리 무한 증가 방지
  dayCount++;
  next();
}

// 상태 확인용
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'habit-tracker-ai', hasKey: !!process.env.GEMINI_API_KEY });
});

app.use('/api', rateLimit, aiRoutes);

// 키 없이 켰을 때 친절한 안내
if (!process.env.GEMINI_API_KEY) {
  console.log('\n⚠️  GEMINI_API_KEY가 비어 있어요.');
  console.log('   server/.env 파일을 만들고 키를 넣어주세요. (README.md 참고)\n');
}

app.listen(PORT, () => {
  console.log(`✅ AI 서버 실행 중 → http://localhost:${PORT}`);
  console.log(`   모델: ${process.env.GEMINI_MODEL || 'gemini-flash-latest'}`);
});
