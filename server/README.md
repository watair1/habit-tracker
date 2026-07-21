# 🤖 해빗 트래커 AI 서버 (Gemini)

이 서버는 앱이 **Gemini AI**를 쓸 수 있게 도와주는 "중계 서버"예요.
API 키를 앱(브라우저)에 직접 넣으면 남에게 노출될 수 있어서, 키는 이 서버에만 넣고 앱은 서버에게 부탁하는 방식이에요.

> 코딩을 몰라도 따라 할 수 있게 아주 자세히 적었어요. 그대로 순서대로 하면 됩니다.

---

## 준비물

- 컴퓨터 (윈도우/맥 아무거나)
- 인터넷
- 구글 계정 (Gemini 키 발급에 필요, **무료**)

---

## 1단계. Node.js 설치하기

Node.js는 이 서버를 실행하는 프로그램이에요.

1. https://nodejs.org 접속
2. **LTS** (왼쪽, "권장") 버튼을 눌러 다운로드
3. 다운로드된 파일을 실행하고 "다음 → 다음 → 설치" 로 끝까지 진행
4. 설치가 잘 됐는지 확인:
   - 윈도우: 시작 메뉴에서 **PowerShell** 검색해서 열기
   - 맥: **터미널** 앱 열기
   - 아래를 입력하고 Enter:
     ```
     node -v
     ```
   - `v20.x.x` 처럼 숫자가 나오면 성공이에요.

---

## 2단계. 서버 폴더로 이동 + 라이브러리 설치

방금 연 PowerShell(또는 터미널)에서 이 `server` 폴더로 이동해요.
(폴더 경로는 본인 컴퓨터에 맞게 바꾸세요.)

```
cd C:\Users\본인이름\Desktop\habit-tracker\server
npm install
```

`npm install` 은 서버가 필요로 하는 부품들을 자동으로 내려받는 명령이에요.
1~2분 걸릴 수 있어요. 에러 없이 끝나면 됩니다.

---

## 3단계. Gemini API 키 발급받기 (무료)

1. https://aistudio.google.com/app/apikey 접속
2. 구글 계정으로 로그인
3. **"Create API key"** (API 키 만들기) 버튼 클릭
4. 만들어진 키(예: `AIzaSy...` 로 시작하는 긴 문자열)를 **복사**
   - ⚠️ 이 키는 비밀번호 같은 거예요. 남에게 보여주거나 인터넷에 올리지 마세요.

---

## 4단계. `.env` 파일 만들기 (키 넣기)

`server` 폴더 안에 있는 `.env.example` 파일을 복사해서 이름을 `.env` 로 바꿔요.

**쉬운 방법 (PowerShell):**
```
Copy-Item .env.example .env
```

그다음 `.env` 파일을 메모장으로 열어서, 3단계에서 복사한 키를 붙여넣어요:

```
GEMINI_API_KEY=여기에_복사한_키_붙여넣기
GEMINI_MODEL=gemini-flash-latest
PORT=3000
```

저장하고 닫으면 끝이에요.

> 💡 `.env` 파일은 절대 GitHub에 올라가지 않게 설정돼 있어요(`.gitignore`). 안심하세요.

---

## 5단계. 서버 실행하기

```
npm start
```

아래처럼 나오면 성공이에요:
```
✅ AI 서버 실행 중 → http://localhost:3000
```

이 창은 **켜둔 채로** 두세요. 창을 닫으면 서버도 꺼져요.
끄고 싶을 땐 그 창에서 `Ctrl + C` 를 누르면 됩니다.

---

## 6단계. 잘 되는지 테스트

서버를 켠 상태에서, **새 PowerShell 창**을 하나 더 열고 아래를 붙여넣어 보세요:

```
curl -X POST http://localhost:3000/api/refine-habit -H "Content-Type: application/json" -d "{\"habitName\":\"공부하기\"}"
```

`{"refined":"...","reason":"..."}` 같은 답이 오면 완벽하게 작동하는 거예요! 🎉

---

## 앱과 연결하기

앱(`index.html`)의 자바스크립트 맨 위에 이런 줄이 있어요:

```js
const AI_SERVER = 'http://localhost:3000';
```

- **내 컴퓨터에서 테스트**할 때는 이대로 두면 돼요.
- **인터넷에 배포**한 서버가 있으면 그 주소로 바꾸면 돼요 (아래 참고).

---

## (선택) 인터넷에 배포하기 — Render 무료

폰에서도 AI 기능을 쓰려면 서버가 인터넷에 떠 있어야 해요. **Render** 무료 플랜을 쓸 수 있어요.

1. https://render.com 가입 (GitHub 계정으로 로그인 추천)
2. **New → Web Service** 선택
3. 이 코드가 올라간 GitHub 저장소를 연결
4. 설정:
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. **Environment(환경 변수)** 에 `GEMINI_API_KEY` 를 추가하고 키 값을 넣기
6. 배포가 끝나면 `https://내서버이름.onrender.com` 주소가 나와요
7. 앱의 `AI_SERVER` 를 그 주소로 바꾸기

> ⚠️ 공개된 서버는 누구나 호출할 수 있어요. 실제 서비스로 쓴다면 호출 횟수를 제한하는 **rate limiting**(예: `express-rate-limit`)을 꼭 추가하세요. 안 그러면 남이 내 키를 대신 써버릴 수 있어요.

---

## 자주 있는 문제

| 증상 | 해결 |
|------|------|
| `node: command not found` | 1단계 Node 설치가 안 된 거예요. 다시 설치 후 창을 새로 여세요. |
| `GEMINI_API_KEY가 비어 있어요` 경고 | `.env` 파일에 키를 안 넣었어요. 4단계 확인. |
| 앱에서 "AI 서버가 꺼져 있어요" | `npm start` 창이 꺼졌는지 확인하세요. |
| `요청이 많아요. 1분 후...` | 무료 플랜은 분당·하루 호출 제한이 있어요. 잠깐(또는 다음 날) 기다리면 풀려요. 많이 쓰려면 Google Cloud에서 결제를 켜면 한도가 크게 늘어요(flash는 매우 저렴). |
| `no longer available to new users` | 오래된 모델이에요. `.env`의 `GEMINI_MODEL`을 `gemini-flash-latest`로 두세요(기본값). |

---

## 엔드포인트 목록 (참고용)

전부 `POST`, 본문은 JSON 이에요.

| 경로 | 하는 일 |
|------|---------|
| `/api/parse-habit` | 자연어 → 습관 목록 |
| `/api/weekly-report` | 주간 리포트(분석 + 격려) |
| `/api/refine-habit` | 습관 구체화 |
| `/api/goal-to-habits` | 목표 → 실천 습관 3~5개 |
| `/api/failure-analysis` | 실패 패턴 분석 + 조언 |
| `/api/day-summary` | 하루 한 줄 총평 |
| `/api/auto-schedule` | 자연어 → 하루 일정표 |
