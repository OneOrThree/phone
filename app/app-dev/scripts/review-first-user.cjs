const { chromium } = require('playwright'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');

const outputDir = path.resolve(__dirname, '../.docs');
const origin = process.env.GROMO_REVIEW_URL || 'http://127.0.0.1:18762';
fs.mkdirSync(outputDir, { recursive: true });

// 실제 RN 화면에 고정 목적지를 넣는 검토다. 서버 인증·섬 생성·항해 API는 호출하지 않는다.
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 402, height: 874 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const url = new URL(origin);
    url.search = '?onboarding=islands';
    await page.goto(url.toString());
    await page.getByTestId('sea-primary-action').click();
    await page.getByTestId('telescope-island-preview-0').waitFor();
    assert.equal(await page.locator('[data-testid^="telescope-art-"]').count(), 2);
    assert.equal(await page.getByTestId('telescope-island-preview-1').count(), 0);
    assert.equal(await page.getByTestId('telescope-island-preview-2').count(), 1);
    await page.evaluate(async () => {
      await Promise.all([...document.images].map((image) => image.decode().catch(() => {})));
    });
    await page.screenshot({ path: path.join(outputDir, 'first-user-existing-islands.png') });
    for (const scenario of ['full', 'uninhabited']) {
      url.search = `?onboarding=${scenario}`;
      await page.goto(url.toString());
      await page.getByTestId('sea-primary-action').click();
      await page.getByTestId('telescope-island-preview-1').waitFor();
      assert.equal(await page.locator('[data-testid^="telescope-art-"]').count(), 1);
      assert.equal(await page.getByText('첫 섬 선택', { exact: true }).count(), 0);
      await page.evaluate(async () => {
        await Promise.all([...document.images].map((image) => image.decode().catch(() => {})));
      });
      await page.screenshot({ path: path.join(outputDir, `first-user-${scenario}.png`) });
    }
    const island = page.getByTestId('telescope-island-preview-1');
    await island.click();
    await page.getByRole('button', { name: '항해하기', exact: true }).click();
    await page.getByRole('button', { name: '항해 시작', exact: true }).click();
    await page.getByTestId('telescope-island-preview-1').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '집중 마치기', exact: true }).waitFor();
    await page.screenshot({ path: path.join(outputDir, 'first-user-depart.png') });
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(outputDir, 'first-user-review.json'),
      JSON.stringify(
        {
          pass: true,
          checks: [
            '바다에서 망원경 열기',
            '들어갈 섬이 있으면 기존 목록 유지',
            '기존 목록이 비었거나 모두 정원 찼으면 무인도 1개',
            '첫 섬 선택 제거',
            '바다 집중 진입',
          ],
          errors,
        },
        null,
        2,
      ),
    );
    console.log('무인도 첫 항해 화면 검토 통과');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
