# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 나에 대해 / 작업 규칙

- 한국어로 답변
- 나는 코딩 초보자. 어려운 용어는 풀어서 설명
- 코드 짜기 전에 뭘 할지 먼저 알려주고 시작
- 한 번에 너무 많이 바꾸지 말기 (작은 단위로)
- 내가 이해 못 한 것 같으면 다시 설명해주기
- 막힐 때는 검색이나 추측 말고 솔직히 모른다고 말하기

## ❌ 하지 마

- 큰 리팩토링 한번에
- 내 동의 없이 새 라이브러리 추가
- API 키 같은 거 코드에 직접 박기

## Running the App

No build system or package manager. Open `index.html` directly in a browser. All code lives in a single file.

## Checking before you push

```powershell
node check.mjs
```

Catches the mistakes that break the whole app but only show up in a browser:
duplicate top-level names, `onclick="foo()"` with no `foo` defined,
`toISOString().slice(0,10)` (UTC — shifts the date by a day in KST), and
API keys hardcoded into the file. Run it after editing `index.html`.

## Deployment

Single-file web app (`index.html`). Push to GitHub → GitHub Pages auto-deploy.

```powershell
node check.mjs
git add index.html
git commit -m "message"
git push origin main
```

Live URL: `https://watair1.github.io/habit-tracker/`  
GitHub remote: `https://github.com/watair1/habit-tracker.git`

No build step, no package.json, no bundler.

## Architecture

Single-file PWA (`index.html`) — all CSS, HTML, and JavaScript in one file. Korean-language UI.

**External dependencies (CDN only, no local installs):**
- Firebase 9.23.0 (compat) — Google Auth + Firestore cloud sync; config hardcoded in `FIREBASE_CONFIG`
- Chart.js 4.4.0 — stats/mood/prediction charts
- Lucide icons
- Pretendard font

## Data Layer

All state lives in `localStorage` via `lsGet(key, default)` / `lsSet(key, value)` wrappers (JSON parse/stringify). The constant `K` maps data types to their storage keys:

| Key | Storage key | Content |
|-----|------------|---------|
| `K.h` | `ht_habits_v2` | habits array |
| `K.u` | `ht_user_v2` | XP, achievements, totalChecks |
| `K.g` | `ht_goals_v1` | goals |
| `K.f` | `ht_final_goal_v1` | life goal |
| `K.t` | `ht_todos_v1` | todos |
| `K.m` | `ht_memos_v1` | memos |
| `K.md` | `ht_mood_v1` | mood records (`{date: moodString}`) |
| `K.n` | `ht_notif_v1` | notification settings |
| `K.ak` | `ht_apikey_v1` | Anthropic API key (not synced to cloud) |

Each data type has a `load*()` / `save*()` pair. `save*()` calls `scheduleSync()` which debounces Firestore writes by 1.5s.

**Cloud sync** — Firestore path: `users/{uid}/data/{habits|user|goals|notif|finalgoal|todos|memos|mood}`. On login, `loadFromCloud()` overwrites localStorage with cloud data. API key (`K.ak`) is intentionally excluded from sync.

## Tab Structure

Five tabs rendered on demand via `switchTab(name)`:

| Tab | Render function | Key content |
|-----|----------------|-------------|
| `today` | `render()` | habit list, mood slider, memos |
| `stats` | `renderStats()` | heatmap, pie/line/mood charts |
| `growth` | `renderGrowth()` | level/XP bar, achievements grid |
| `goals` | `renderGoals()` + `renderFinalGoal()` + `renderTodos()` | life goal, todos, goal cards, growth prediction |
| `analysis` | `renderAnalysis()` | Claude AI feedback, day/time/fail analysis, notifications |

## XP & Level System

Levels (XP thresholds): 새싹(0) → 도전자(100) → 습관인(250) → 마스터(500) → 레전드(900) → 신화(1500)

`addXP(amt)` increments XP and shows a level-up toast if threshold crossed. Levels defined in `LVS` array.

XP sources: habit check (+10 base, +5 if ≥3-day streak, +10 if ≥7-day streak), all habits done (+20 bonus), goal added (+15), achievement unlocked (+30), first habit ever (+20).

Achievements defined in `ACHS` array; each has an `ok(habits, user)` predicate checked after every state change via `checkAchs()`.

## Claude AI Analysis

The Analysis tab calls the Anthropic API directly from the browser:
- Model: `claude-haiku-4-5-20251001`
- Endpoint: `https://api.anthropic.com/v1/messages`
- Requires header `anthropic-dangerous-allow-browser: true`
- API key stored only in `localStorage` (never synced to Firestore)
- `buildAnalysisData()` → `buildPrompt()` → `callClaudeAPI()` → `parseAIResponse()` splits `## section` headings into cards

## Modals

`openModal(id)` / `closeModal(id)` toggle `.open` class on `.overlay` elements. The add-habit modal doubles as edit-habit modal: `editingHabitIdx` tracks whether `addHabit()` should insert or update.

## Key Patterns

- `$('id')` — shorthand for `document.getElementById('id')`
- `todayStr()` — returns `YYYY-MM-DD`
- `uid()` — generates random 8-char alphanumeric IDs
- `esc(s)` — HTML-escapes strings; must be used for any user-supplied strings in `innerHTML`
- CSS variables in `:root` — accent `--primary: #b3f000` (lime green), background `--bg: #0a0a0a`
- Chart instances (`chartPie`, `chartLine`, `chartMood`, `chartTime`, `chartPred`) must be `.destroy()`-ed before re-creating to avoid canvas reuse errors
- PWA manifest and icon generated dynamically at runtime via canvas — no static manifest file
