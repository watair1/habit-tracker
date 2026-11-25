# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 나에 대해 / 작업 규칙

- 한국어로 답변
- 코드 짜기 전에 뭘 할지 먼저 알려주고 시작
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

**Nothing but the font and Lucide is in `<head>`, and Lucide is `defer`.** Chart.js and the
three Firebase SDKs are fetched at the moment they are needed via `loadScript(src)` (which
caches the promise, so a URL is only fetched once). Chart.js loads when a chart is drawn,
Firebase from `initFirebase()` which `init()` defers with `setTimeout(..., 0)` so it starts
after first paint. This is not an optional nicety: when all six sat in `<head>` as blocking
scripts, the browser painted nothing until 736KB had downloaded and executed — about 844ms on
good LTE — and the first screen uses none of it. Do not move these back into `<head>`.

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
| `K.d` | `ht_day_v1` | per-day data (`{date: {highlight, todos, events, memo, sleep, chat}}`) |
| `K.tpl` | `ht_templates_v1` | day templates |
| `K.wk` | `ht_weekplan_v1` | weekly plan (`{cats, weeks}`) — 분야 is global, targets are per-week |
| `K.fc` | `ht_forecast_v1` | AI predictions and their scores (`{bets: [...]}`) |
| `K.ak` | `ht_apikey_v1` | Anthropic API key (not synced to cloud) |

Two localStorage keys sit outside `K` because they are per-device UI state, not data:
`ht_lasttab_v1` (`{tab, at}` — the tab you were last on, restored on load if less than
4 hours old) and `ht_syncmeta_v1`. Neither is synced or backed up.

**Photos live in IndexedDB, not localStorage** — db `ht_images_v1`, store `imgs`,
records `{id, blob, w, h, size, at}`. localStorage caps out around 5MB, which a few
phone photos would blow through, taking habit saves down with it. Memos and day
records store only photo *ids* (`memo.images[]`, `day.photos[]`); `imgUrl(id)` turns an
id into a displayable object URL (cached in `_imgUrls`). Incoming files are shrunk to
1600px / JPEG 0.82 by `shrinkImage()` before storage. IndexedDB is per-device, so
photos do not sync between phone and PC — but `exportData()` packs them into the
backup file as data URLs and `importData()` unpacks them.

Each data type has a `load*()` / `save*()` pair. `save*()` calls `scheduleSync()` which debounces Firestore writes by 1.5s.

`exportData()` is async because it has to read photos out of IndexedDB. Backup
payloads are `version: 2` (`{app, version, exportedAt, data, images}`); version 1
files have no `images` key and still restore fine.

**Cloud sync** — the store list lives in `SYNC_STORES`; Firestore path is `users/{uid}/data/{storeName}`. `lsSet` stamps each store's last-edit time into `ht_syncmeta_v1`, so uploads only carry stores that actually changed and `loadFromCloud()` keeps whichever side is newer per store (it does not blanket-overwrite). API key (`K.ak`) is intentionally excluded from sync.

**Habit shape** — `{id, name, createdAt, checked, paid, category, timeSlot, freq, min}`. `checked[date]` is `true` (완료) or `'min'` (최소 버전만). Both count as done everywhere, so never compare with `=== true`; use truthiness. `min` is the optional "바쁜 날엔 이거라도" text.

`paid[date]` is the XP ledger — how much that date has already paid out. Unchecking
does **not** clear it, so check→uncheck→check pays nothing the second time. All four
check paths (today tab, day tab, event-linked auto-check, AI coach) go through
`awardHabitXP(h, date, want)`; never award habit XP anywhere else. The all-done
+20 is gated separately by `user.dayBonus[date]`. `user.totalChecks` is no longer
incremented by hand — `checkAchs()` recomputes it from `habitCheckTotal(habits)`
on every call, so an inflated value from the old bug heals itself.

**Habit math** — `habitPeriodsDetailed(h)` is the single source of truth: it returns `[{key, done}]` per judged period (day for daily/days, week start for weekly) and drops the still-in-progress trailing period. `habitPeriods`, `streakCount`, `maxStreak`, `successRate`, `habitRecovery`, and `scoreBet` all derive from it.

## Tab Structure

Five tabs rendered on demand via `switchTab(name)`:

| Tab | Render function | Key content |
|-----|----------------|-------------|
| `today` | `render()` | habit list, mood slider, memos (+ photos, export) |
| `day` | `renderDay()` | calendar, todos, events, day memo, day photos |
| `stats` | `renderStats()` | heatmap, pie/line/mood charts |
| `growth` | `renderGrowth()` | level/XP bar, achievements grid |
| `goals` | `renderGoals()` + `renderFinalGoal()` + `renderTodos()` | life goal, todos, goal cards, growth prediction |
| `analysis` | `renderAnalysis()` | Claude AI feedback, day/time/fail analysis, notifications |

## Bottom Tab Bar

Six animated styles in `NAV_STYLES` (expand → pill → fill → notch → bubble → bulge), each
unlocked at the matching level (Lv.1–6). `user.navStyle` holds the pick (synced with `K.u`);
`navStyleNow()` falls back to the highest unlocked style if the pick is locked. The picker
lives in the 성장 tab (`renderNavPicker()`); on level-up `navOnLevelUp()` switches to the
newly opened style and the toast says so. `switchTab()` drives the animation through
`navSelect(i)` — don't move the `.active` class on nav buttons by hand. Test: `test/navcheck.mjs`.

## AI Icon (레벨로 열리는 AI 아이콘)

Every AI spot (the AI button, the 비서 sheet title and avatar, "AI 분석 받기" and the like) uses
`<i class="ai-ico">`, not a Lucide icon. `.ai-ico` paints `currentColor` through a CSS mask set to
the `--ai-ico` custom property, so dynamic templates pick up the current icon with no extra call.
`AI_ICONS` holds four hand-drawn 24-grid icons unlocked by level (talk Lv.1, net Lv.2, orbit Lv.4,
cursor Lv.6). `user.aiIcon` holds the pick (synced with `K.u`); `aiIconNow()` falls back to the
newest unlocked one; `aiIconApply()` sets `--ai-ico` (called from `init()` and after login). The
picker lives in the 성장 tab (`renderAiIconPicker()`), and `aiIconOnLevelUp()` switches to a newly
opened icon and the level-up toast names it. The 핵심 (importance 3) marker on memos is not an AI
spot and stays a Lucide sparkle. Test: `test/aiiconcheck.mjs`.

## Swipe Between Tabs

Swiping sideways on a phone moves to the next/previous tab in tab-bar order (left swipe = next),
stopping at the ends. It ignores short, slow (>700ms), or mostly-vertical swipes, swipes that start
within 24px of the screen edge (the phone's back gesture), and swipes that start on inputs, inside
anything that scrolls sideways, on the week-plan grid or timeline events, on the tab bar, while a
modal is open, or while the AI agent is playing. It clicks the real nav button, so `switchTab()` and
the tab-bar animation run as usual; the new tab slides in from the swipe side (`.swipe-next` /
`.swipe-prev`). Test: `test/swipecheck.mjs`.

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

## AI Server Provider

`server/llm.js` picks the model: `AI_PROVIDER=claude` → `server/claude.js` (Sonnet 5.5 by default,
`AI_CLAUDE_MODEL` / `AI_CLAUDE_EFFORT`), otherwise Gemini. Claude is refused when `ALLOWED_EMAILS`
is empty (it costs money). The AI 비서 has an effort chip (`low/medium/high`) left of its input;
the pick lives in `user.aiEffort` (synced) and goes out as `effort` on `/api/day-agent`. The
server accepts only those three values. Env var names avoid `CLAUDE_*` because tooling sets those.

## Visible AI Agent (보이는 AI 비서)

The AI 비서 lists its actions in chat with an "이대로 적용" button — that is the user's
confirmation step. Pressing it runs `applyAgentActions(idx)`, which plays each action on screen:
`agReveal(a)` goes to the action's tab (the cursor presses the tab bar, then `gotoTab`), scrolls the
target into view, then the cursor flies there, presses, and `runAgentActions([a])` applies just that
one action. `agTarget(a)` maps all 20 action types to a tab + element (falling back to the section
container). During play the screen edge glows (`.ag-glow`, opacity-only animation — animating
box-shadow overheats devices), a comet trail follows the cursor (canvas), and tapping anywhere pauses.
The done card offers 되돌리기, which restores a localStorage snapshot of `AG_STORES()` taken before
the run. `prefers-reduced-motion` applies everything at once. All colors come from `--agent`
(temporary until the theme is chosen). `runAgentActions(actions)` is the pure apply step — tests that
only check logic should call it directly. Test: `test/agentplaycheck.mjs`.

## Modals

`openModal(id)` / `closeModal(id)` toggle `.open` class on `.overlay` elements.
`.sheet` carries `max-height: 88vh; overflow-y: auto`, so long modals scroll instead
of running off the bottom of the screen — do not remove it. The add-habit modal doubles as edit-habit modal: `editingHabitIdx` tracks whether `addHabit()` should insert or update.

## Key Patterns

- `$('id')` — shorthand for `document.getElementById('id')`
- `todayStr()` — returns `YYYY-MM-DD`
- `uid()` — generates random 8-char alphanumeric IDs
- `esc(s)` — HTML-escapes strings; must be used for any user-supplied strings in `innerHTML`
- CSS variables in `:root` — accent `--primary: #b3f000` (lime green), background `--bg: #0a0a0a`
- Charts go through `drawChart(key, canvasId, config)`, which loads Chart.js if needed, bails
  if the canvas left the DOM while loading, and destroys the previous instance before creating
  a new one (canvas reuse throws otherwise). Instances live in the `CHARTS` registry; clear one
  with `killChart(key)`. Never call `new Chart()` directly.
- If Chart.js can't be fetched (offline), `drawChart` gives up quietly — the rest of the tab
  still renders. Keep it that way: the numbers and heatmap matter more than the graph.
- PWA manifest and icon generated dynamically at runtime via canvas — no static manifest file.
  `drawGrass()` draws the stats-tab heatmap grid by hand (emoji render differently per device);
  `generateIcon()` is the rounded-square version and `generateMaskableIcon()` the full-bleed one
  Android crops. `GRASS` runs greener than the on-screen `.hm-*` colors on purpose — the exact
  screen values go muddy at 44px.
- The app is started by an IIFE at the **bottom** of the script. It has to run after the
  consts above it are initialized — when it sat mid-file it crashed reading `ICON_BG`.
- Download filenames must be ASCII. Browsers drop a non-ASCII `download` attribute
  entirely and save the file as extensionless `download`.
