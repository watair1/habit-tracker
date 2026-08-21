// 사진 — 넣기, 줄이기, 크게 보기, 지우기, 백업에 담기
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import { readFileSync } from 'fs';

const APP = pathToFileURL(new URL('../index.html', import.meta.url).pathname).href;
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const b = await chromium.launch(LAUNCH);
const ctx = await b.newContext({ timezoneId: 'Asia/Seoul', viewport: { width: 412, height: 800 } });

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
page.on('dialog', d => d.accept());          // confirm 은 전부 확인

await page.goto(APP);
await page.waitForFunction(() => typeof window.saveImageFile === 'function');

const R = [];
const yes = (n, cond, got) => R.push({ n, pass: !!cond, got: got ?? '' });
const ok  = (n, got, want) => R.push({ n, pass: JSON.stringify(got) === JSON.stringify(want), got, want });

// 테스트용 큰 사진을 브라우저 안에서 만들어요 (파일 고르는 창을 안 거치고 바로 저장)
const makeFile = (w, h) => page.evaluate(([w, h]) => new Promise(res => {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.fillStyle = '#b3f000'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#000'; g.fillRect(0, 0, w / 2, h / 2);
  cv.toBlob(blob => {
    window.__f = new File([blob], 'test.png', { type: 'image/png' });
    res(blob.size);
  }, 'image/png');
}), [w, h]);

// ── 1. 사진을 줄여서 저장 ────────────────────────────────
{
  const before = await makeFile(3000, 2000);   // 폰 사진만 한 크기
  const rec = await page.evaluate(async () => {
    const id = await saveImageFile(window.__f);
    const r = await imgGet(id);
    return { id, w: r.w, h: r.h, size: r.size, type: r.blob.type };
  });
  ok('긴 쪽이 1600 으로 줄어듦', [rec.w, rec.h], [1600, 1067]);
  yes('JPEG 로 바뀜', rec.type === 'image/jpeg', rec.type);
  yes('용량이 크게 줄어듦', rec.size < before / 2, `${Math.round(before/1024)}KB → ${Math.round(rec.size/1024)}KB`);
  yes('번호가 붙음', /^[a-z0-9]{6,}$/i.test(rec.id), rec.id);

  // 작은 사진은 늘리지 않아요
  await makeFile(200, 100);
  const small = await page.evaluate(async () => {
    const id = await saveImageFile(window.__f);
    return await imgGet(id);
  });
  ok('작은 사진은 그대로', [small.w, small.h], [200, 100]);
}

// ── 2. 메모에 붙이기 ─────────────────────────────────────
{
  await page.evaluate(() => { saveMemos([]); renderMemos(); openMemoModal(); });
  await page.fill('#memo-title-input', '사진 붙은 메모');
  await page.evaluate(() => autoSaveMemo());
  await page.waitForTimeout(100);

  await makeFile(900, 900);
  const ids = await page.evaluate(async () => {
    // pickPhotos 는 파일 고르는 창을 띄우니, 그 뒤에 하는 일만 그대로 흉내냅니다
    const id = await saveImageFile(window.__f);
    const memos = loadMemos();
    memos[0].images = [...(memos[0].images || []), id];
    saveMemos(memos);
    renderMemoPhotos(memos[0].images);
    renderMemos();
    return memos[0].images;
  });
  ok('메모에 사진 번호가 적힘', ids.length, 1);

  await page.waitForTimeout(300);
  yes('메모 모달에 썸네일이 뜸', await page.locator('#memo-photos .ph-thumb img').count() === 1);
  const src = await page.getAttribute('#memo-photos .ph-thumb img', 'src');
  yes('썸네일에 실제 그림이 채워짐', (src || '').startsWith('blob:'), (src || '').slice(0, 12));
  yes('사진 추가 버튼이 있음', await page.locator('#memo-photos .ph-add').isVisible());

  // 목록에도 사진 개수가 보이는지
  yes('메모 목록에 사진 표시', (await page.textContent('#memo-list')).includes('1'));

  // 내보내기 글자에 장수
  const t = await page.evaluate(() => memoExportText());
  yes('내보낸 글자에 사진 장수', t.includes('사진 1장'), t.split('\n').slice(0, 6).join(' / '));
}

// ── 3. 크게 보기 ─────────────────────────────────────────
{
  await page.click('#memo-photos .ph-thumb img');
  await page.waitForTimeout(250);
  yes('크게 보기가 열림', await page.isVisible('#photo-view.open'));
  const big = await page.getAttribute('#photo-view-img', 'src');
  yes('큰 그림이 채워짐', (big || '').startsWith('blob:'));
  await page.click('.ph-view-x');
  await page.waitForTimeout(150);
  yes('닫힘', !(await page.isVisible('#photo-view.open')));
  yes('닫으면 그림을 놓아줌', !(await page.getAttribute('#photo-view-img', 'src')));
}

// ── 4. 사진 빼기 ─────────────────────────────────────────
{
  const gone = await page.evaluate(async () => {
    const id = loadMemos()[0].images[0];
    await delMemoPhoto(id);
    return { left: loadMemos()[0].images.length, stillThere: !!(await imgGet(id)) };
  });
  ok('메모에서 빠짐', gone.left, 0);
  yes('보관함에서도 지워짐 (자리만 차지하지 않게)', !gone.stillThere);
}

// ── 5. 메모를 지우면 사진도 같이 ─────────────────────────
{
  const res = await page.evaluate(async () => {
    const id = await saveImageFile(window.__f);
    const memos = loadMemos();
    memos[0].images = [id];
    saveMemos(memos);
    currentMemoId = memos[0].id;
    deleteMemoModal();                       // confirm 은 테스트가 자동으로 확인 눌러줘요
    await new Promise(r => setTimeout(r, 250));
    return { memos: loadMemos().length, img: !!(await imgGet(id)) };
  });
  ok('메모가 지워짐', res.memos, 0);
  yes('붙어 있던 사진도 같이 지워짐', !res.img);
}

// ── 6. 하루 기록에 붙이기 ────────────────────────────────
{
  await page.evaluate(() => gotoTab('day'));
  await page.waitForTimeout(200);
  await makeFile(1200, 800);
  await page.evaluate(async () => {
    const id = await saveImageFile(window.__f);
    const d = getDay(dayCursor);
    d.photos = [id];
    setDay(dayCursor, d);
    renderDayPhotos(d.photos);
  });
  await page.waitForTimeout(300);
  yes('하루 탭에 썸네일이 뜸', await page.locator('#day-photos .ph-thumb img').count() === 1);
  yes('하루 사진이 저장됨', await page.evaluate(() => getDay(dayCursor).photos.length === 1));

  // 사진만 남긴 날도 달력에 점이 찍혀야 해요. 안 그러면 나중에 못 찾습니다.
  yes('사진만 있는 날도 달력에 표시됨', await page.evaluate(() => {
    const d = getDay('2019-05-05'); d.photos = ['가짜번호']; setDay('2019-05-05', d);
    return hasDayData('2019-05-05');
  }));

  // 날짜를 옮기면 그 날 사진만 보여야 함
  await page.evaluate(() => { dayCursor = '2020-01-01'; renderDay(); });
  await page.waitForTimeout(250);
  ok('다른 날엔 사진이 없음', await page.locator('#day-photos .ph-thumb').count(), 0);
}

// ── 7. 백업에 담기고 되살아나는지 ────────────────────────
{
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => exportData()),
  ]);
  const payload = JSON.parse(readFileSync(await dl.path(), 'utf8'));
  yes('백업에 사진이 담김', (payload.images || []).length > 0, (payload.images || []).length);
  yes('사진이 글자로 바뀌어 담김', (payload.images[0].data || '').startsWith('data:image/'));
  yes('기록도 그대로 담김', !!payload.data['ht_day_v1']);

  // 보관함을 비운 뒤 백업에서 되살리기
  const back = await page.evaluate(async payload => {
    const all = await imgAll();
    for (const r of all) await imgDelete(r.id);
    const emptied = (await imgAll()).length;
    const n = await unpackImages(payload.images);
    const rec = await imgGet(payload.images[0].id);
    return { emptied, n, w: rec && rec.w, isBlob: !!(rec && rec.blob && rec.blob.size) };
  }, payload);
  ok('보관함을 비웠음', back.emptied, 0);
  yes('백업에서 사진이 돌아옴', back.n > 0, back.n);
  yes('돌아온 게 진짜 사진', back.isBlob && back.w > 0, `${back.w}px`);
}

// ── 8. 사진 용량 안내 ────────────────────────────────────
{
  await page.evaluate(() => gotoTab('analysis'));
  await page.waitForTimeout(400);
  const txt = await page.textContent('#img-usage');
  yes('백업 카드에 사진 용량이 보임', /사진 \d+장/.test(txt) && /(KB|MB)/.test(txt), txt);
  yes('이 기기에만 있다고 알려줌', /기기/.test(txt));
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
