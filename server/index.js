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

app.use(cors());                      // 정적 PWA에서 호출 허용
app.use(express.json({ limit: '1mb' }));

// 상태 확인용
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'habit-tracker-ai', hasKey: !!process.env.GEMINI_API_KEY });
});

app.use('/api', aiRoutes);

// 키 없이 켰을 때 친절한 안내
if (!process.env.GEMINI_API_KEY) {
  console.log('\n⚠️  GEMINI_API_KEY가 비어 있어요.');
  console.log('   server/.env 파일을 만들고 키를 넣어주세요. (README.md 참고)\n');
}

app.listen(PORT, () => {
  console.log(`✅ AI 서버 실행 중 → http://localhost:${PORT}`);
  console.log(`   모델: ${process.env.GEMINI_MODEL || 'gemini-flash-latest'}`);
});
