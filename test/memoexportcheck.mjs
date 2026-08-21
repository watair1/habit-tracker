// 메모 내보내기 — 글자로 잘 뽑히는지, 파일/복사 둘 다 되는지
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import { readFileSync } from 'fs';

const APP = pathToFileURL(new URL('../index.html', import.meta.url).pathname).href;
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const b = await chromium.launch(LAUNCH);
const ctx = await b.newContext({
  timezoneId: 'Asia/Seoul', viewport: { width: 412, height: 800 },
  permissions: ['clipboard-read', 'clipboard-write'],
});

await ctx.route('**/*', r => {
  const u = r.request().url();
  if (u.startsWith('file:')) return r.continue();
  if (/chart\.js|lucide|pretendard|firebase|gstatic/.test(u))
    return r.fulfill({ status: 200, contentType: 'application/javascript',
      body: 'window.Chart=function(){this.destroy=function(){}};window.lucide={createIcons(){}};' });
  return r.fulfill({ status: 200, body: '' });
});

const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));

await page.addInitScript(() => {
  localStorage.setItem('ht_memos_v1', JSON.stringify([
    { id: 'm1', title: '첫 아이디어', content: '내용 한 줄\n두 번째 줄 #태그하나', tags: ['태그하나'],
      createdAt: '2026-08-01', updatedAt: '2026-08-01', importance: 3, rating: 'good',
      starred: true, graduated: false, appendix: [{ text: '덧댄 한 줄', at: '2026-08-05' }] },
    { id: 'm2', title: '둘째 아이디어', content: '짧게', tags: [],
      createdAt: '2026-08-10', updatedAt: '2026-08-10', importance: 1, rating: null,
      starred: false, graduated: false, appendix: [] },
    { id: 'm3', title: '졸업한 것', content: '기본 목록에선 빠져요', tags: [],
      createdAt: '2026-07-01', updatedAt: '2026-07-01', importance: 2, rating: null,
      starred: false, graduated: true, appendix: [] },
  ]));
});

await page.goto(APP);
await page.waitForFunction(() => typeof window.memoExportText === 'function');

const R = [];
const yes = (n, cond, got) => R.push({ n, pass: !!cond, got: got ?? '' });

// ── 뽑힌 글자 ────────────────────────────────────────────
{
  const t = await page.evaluate(() => memoExportText());
  yes('제목이 들어감', t.includes('# 첫 아이디어') && t.includes('# 둘째 아이디어'));
  yes('졸업한 메모는 기본으론 빠짐', !t.includes('졸업한 것'));
  yes('여러 줄 내용이 그대로 살아 있음', t.includes('내용 한 줄\n두 번째 줄'));
  yes('태그가 들어감', t.includes('#태그하나'));
  yes('만든 날짜가 들어감', t.includes('2026-08-01'));
  yes('중요도가 글자로 나옴', t.includes('핵심') && t.includes('보통'));
  yes('평가가 글자로 나옴', t.includes('좋아'));
  yes('즐겨찾기 표시', t.includes('즐겨찾기'));
  yes('덧댄 생각이 들어감', t.includes('덧댄 한 줄') && t.includes('2026-08-05'));
  yes('맨 위에 개수', /메모 2개/.test(t), t.split('\n')[0]);
}

// ── 필터가 걸려 있으면 그것만 ────────────────────────────
{
  await page.evaluate(() => setMemoFilter('starred'));
  const t = await page.evaluate(() => memoExportText());
  yes('즐겨찾기만 나감', t.includes('첫 아이디어') && !t.includes('둘째 아이디어'));

  await page.evaluate(() => openMemoExport());
  const warn = await page.textContent('#mex-count');
  yes('"일부만 나간다" 고 알려줌', /즐겨찾기/.test(warn) && /1개/.test(warn), warn);
  await page.evaluate(() => closeModal('memo-export-modal'));
  await page.evaluate(() => setMemoFilter('all'));
}

// ── 검색이 걸려 있으면 그것만 ────────────────────────────
{
  await page.fill('#memo-search', '둘째');
  const t = await page.evaluate(() => memoExportText());
  yes('검색 결과만 나감', t.includes('둘째 아이디어') && !t.includes('첫 아이디어'));
  await page.fill('#memo-search', '');
}

// ── 화면에 그리는 것과 내보내는 게 같은 규칙 ─────────────
{
  await page.fill('#memo-search', '없는말123');
  const shown = await page.textContent('#memo-list');
  const n = await page.evaluate(() => filteredMemos().list.length);
  yes('검색 결과 없으면 화면도 목록도 비어 있음', n === 0 && /검색 결과가 없어요/.test(shown));
  await page.fill('#memo-search', '');
}

// ── 버튼 두 개 ───────────────────────────────────────────
{
  await page.evaluate(() => openMemoExport());
  yes('내보내기 창이 열림', await page.isVisible('#memo-export-modal.open'));
  yes('파일 버튼 있음', await page.getByRole('button', { name: '파일로 저장' }).isVisible());
  yes('복사 버튼 있음', await page.getByRole('button', { name: '복사하기' }).isVisible());

  await page.getByRole('button', { name: '복사하기' }).click();
  await page.waitForTimeout(400);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  yes('클립보드에 실제로 담김', clip.includes('# 첫 아이디어'), clip.slice(0, 30));
  yes('복사 뒤 창이 닫힘', !(await page.isVisible('#memo-export-modal.open')));

  await page.evaluate(() => openMemoExport());
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '파일로 저장' }).click(),
  ]);
  yes('파일 이름이 .txt', dl.suggestedFilename().endsWith('.txt'), dl.suggestedFilename());
  yes('파일 이름에 날짜', /\d{4}-\d{2}-\d{2}/.test(dl.suggestedFilename()), dl.suggestedFilename());
  // 한글 파일 이름을 쓰면 브라우저가 이름을 통째로 버리고 확장자 없는
  // 'download' 로 저장해버려요. 그럼 파일이 안 열립니다. 다시 그러지 않게 막아둡니다.
  yes('파일 이름이 영어 (한글이면 브라우저가 버림)',
      /^[\x20-\x7E]+$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  const body = readFileSync(await dl.path(), 'utf8');
  yes('파일 첫 글자가 BOM (메모장에서 한글 안 깨짐)', body.charCodeAt(0) === 0xFEFF);
  yes('파일 안에 메모가 들어 있음', body.includes('# 첫 아이디어') && body.includes('덧댄 한 줄'));
}

// ── 메모가 하나도 없으면 ────────────────────────────────
{
  await page.evaluate(() => { saveMemos([]); renderMemos(); openMemoExport(); });
  await page.waitForTimeout(150);
  yes('메모 없으면 창을 안 염', !(await page.isVisible('#memo-export-modal.open')));
}

if (errs.length) R.push({ n: 'pageerror', pass: false, got: errs.join(' | '), want: '없음' });

let bad = 0;
for (const r of R) {
  if (!r.pass) bad++;
  console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.n + (r.pass ? '' : `\n      받음: ${JSON.stringify(r.got)}`));
}
console.log(bad ? `\n${bad}개 실패` : '\n전부 통과');
await b.close();
process.exit(bad ? 1 : 0);
