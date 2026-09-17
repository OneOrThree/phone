const { chromium } = require('playwright'),
  assert = require('assert'),
  fs = require('fs'),
  path = require('path');
const outputDir = path.resolve(__dirname, '../.docs');
fs.mkdirSync(outputDir, { recursive: true });
(async () => {
  const b = await chromium.launch(),
    p = await b.newPage({ viewport: { width: 402, height: 874 } }),
    errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://127.0.0.1:18762');
  await p.getByRole('checkbox').waitFor();
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(outputDir, 'first-user-start.png') });
  assert.equal(await p.getByRole('button', { name: '목업 체험 도구' }).count(), 0);
  await p.getByRole('checkbox').click();
  await p.getByRole('button', { name: 'GROMO 시작하기' }).click();
  await p.getByRole('button', { name: '치즈', exact: true }).click();
  await p.getByRole('textbox', { name: '닉네임', exact: true }).fill('첫고양이');
  await p.getByRole('button', { name: '내 고양이와 시작', exact: true }).click();
  await p.getByRole('button', { name: '혼자 시작할 섬 만들기', exact: true }).click();
  await p.getByRole('textbox', { name: '섬 이름', exact: true }).fill('나의 첫 섬');
  await p.getByRole('textbox', { name: '섬 소개', exact: true }).fill('매일 조금씩');
  await p.getByRole('button', { name: '섬 만들기', exact: true }).click();
  await p.getByRole('button', { name: '건너뛰기', exact: true }).waitFor({ timeout: 11000 });
  await p.getByRole('button', { name: '건너뛰기', exact: true }).click();
  await p.getByRole('button', { name: '집중 시작', exact: true }).click();
  await p.getByRole('textbox', { name: '오늘의 할 일', exact: true }).waitFor({ timeout: 8000 });
  await p.getByRole('textbox', { name: '오늘의 할 일', exact: true }).fill('첫 집중');
  await p.getByRole('button', { name: '집중 시작', exact: true }).click();
  await p.getByRole('button', { name: '휴식하기', exact: true }).waitFor();
  await p.reload();
  await p.getByRole('button', { name: '휴식하기', exact: true }).waitFor();
  assert.ok((await p.locator('body').innerText()).includes('첫 집중'));
  await p.getByRole('button', { name: '종료', exact: true }).click();
  await p.getByRole('button', { name: '취소', exact: true }).click();
  await p.getByRole('button', { name: '종료', exact: true }).click();
  await p.getByRole('button', { name: '확인', exact: true }).click();
  await p.getByRole('button', { name: '섬으로 돌아가기', exact: true }).click();
  await p.getByRole('button', { name: '알겠어', exact: true }).waitFor({ timeout: 8000 });
  assert.ok((await p.locator('body').innerText()).includes('마을회관부터 지어보자'));
  await p.getByRole('button', { name: '알겠어', exact: true }).click();
  assert.equal(await p.getByRole('button', { name: '알겠어', exact: true }).count(), 0);
  await p.getByRole('button', { name: '내 배', exact: true }).click();
  await p.getByRole('button', { name: '내 정보', exact: true }).waitFor({ timeout: 8000 });
  fs.writeFileSync(
    path.join(outputDir, 'first-user-review.json'),
    JSON.stringify(
      {
        pass: true,
        checks: [
          '약관',
          '캐릭터·닉네임',
          '혼자 섬 생성',
          '항해·안내',
          '부두 이동 후 집중',
          '앱 재시작·세션 복원',
          '종료 취소·확인',
          '첫 집중 후 회관 안내 1회',
          '초기 내 배 진입',
        ],
        errors,
      },
      null,
      2,
    ),
  );
  await b.close();
  console.log('FIRST USER PASS');
})();
