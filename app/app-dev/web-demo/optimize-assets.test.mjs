import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { findMissingReferences, pool, rewriteReferences } from './optimize-assets.cjs';

const hash = (text) => crypto.createHash('md5').update(text).digest('hex');
const A = '/assets/src/assets/a.' + hash('a') + '.png';
const B = '/assets/src/assets/b.' + hash('b') + '.png';
const A_WEBP = '/assets/src/assets/a.' + hash('a-webp') + '.webp';
// 이름순으로 main이 분할 번들보다 먼저 처리되게 해, main 이름이 두 번 바뀌는 경우를 만든다.
const MAIN = `index-${'1'.repeat(32)}.js`;
const CHUNK = `index-${'2'.repeat(32)}.js`;

// expo export 결과와 같은 배치의 작은 폴더를 만든다: 번들 하나, 분할 번들 하나, HTML, 에셋.
function fixture() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'web-demo-assets-'));
  const js = path.join(out, '_expo/static/js/web');
  fs.mkdirSync(js, { recursive: true });
  fs.mkdirSync(path.join(out, 'assets/src/assets'), { recursive: true });
  for (const uri of [A, B, A_WEBP]) fs.writeFileSync(path.join(out, uri), 'x');
  fs.writeFileSync(path.join(js, CHUNK), '__d(function(){},1,[]);');
  fs.writeFileSync(
    path.join(js, MAIN),
    `e.exports={uri:"${A}",width:2,height:1};e.exports={uri:"${B}",width:1,height:1};` +
      `load("/_expo/static/js/web/${CHUNK}")`,
  );
  fs.writeFileSync(
    path.join(out, 'index.html'),
    `<script src="/_expo/static/js/web/${MAIN}" defer></script>`,
  );
  return out;
}

test('교체 대상 주소만 바꾸고 바뀐 번들의 이름과 HTML 참조를 새 해시로 옮긴다', () => {
  const out = fixture();
  const renames = rewriteReferences(out, new Map([[A, A_WEBP]]));
  const js = path.join(out, '_expo/static/js/web');
  const renamed = renames.get(MAIN);
  const text = fs.readFileSync(path.join(js, renamed), 'utf8');

  assert.equal(renamed, `index-${hash(text)}.js`);
  assert.ok(!fs.existsSync(path.join(js, MAIN)));
  assert.ok(fs.existsSync(path.join(js, CHUNK)), '참조가 없는 분할 번들은 그대로다');
  assert.ok(text.includes(`uri:"${A_WEBP}",width:2,height:1`), '크기 정보는 그대로 둔다');
  assert.ok(text.includes(`uri:"${B}"`));
  assert.ok(fs.readFileSync(path.join(out, 'index.html'), 'utf8').includes(renamed));
  assert.deepEqual(findMissingReferences(out), []);
});

test('번들에 없는 주소를 바꾸라고 하면 그 주소를 알리며 실패한다', () => {
  const out = fixture();
  const none = '/assets/src/assets/none.' + hash('none') + '.png';
  assert.throws(
    () =>
      rewriteReferences(
        out,
        new Map([
          [A, A_WEBP],
          [none, A_WEBP],
        ]),
      ),
    (error) => error.message.includes('찾지 못한 에셋 참조 1개') && error.message.includes(none),
  );
});

test('같은 주소가 번들에 두 번 나와도 모두 바꾸고, 여러 번 바뀐 번들은 최종 이름을 돌려준다', () => {
  const out = fixture();
  const js = path.join(out, '_expo/static/js/web');
  fs.appendFileSync(path.join(js, CHUNK), `e.exports={uri:"${A}"};`);
  const renames = rewriteReferences(out, new Map([[A, A_WEBP]]));
  assert.deepEqual([...renames.keys()].sort(), [CHUNK, MAIN].sort());
  assert.deepEqual(fs.readdirSync(js).sort(), [...renames.values()].sort());
  for (const name of fs.readdirSync(js))
    assert.ok(!fs.readFileSync(path.join(js, name), 'utf8').includes(A), name);
  const main = fs.readFileSync(path.join(js, renames.get(MAIN)), 'utf8');
  assert.ok(main.includes(renames.get(CHUNK)), '이름이 바뀐 분할 번들을 가리킨다');
  assert.ok(fs.readFileSync(path.join(out, 'index.html'), 'utf8').includes(renames.get(MAIN)));
  assert.deepEqual(findMissingReferences(out), []);
});

test('소스맵이 있는 번들은 이름을 바꾸지 않고 실패한다', () => {
  const out = fixture();
  fs.appendFileSync(
    path.join(out, '_expo/static/js/web', MAIN),
    `\n//# sourceMappingURL=${MAIN}.map`,
  );
  assert.throws(() => rewriteReferences(out, new Map([[A, A_WEBP]])), /소스맵/);
});

test('번들이 가리키는 에셋이 없으면 찾아낸다', () => {
  const out = fixture();
  fs.rmSync(path.join(out, B));
  assert.deepEqual(findMissingReferences(out), [B]);
});

test('바꾼 옛 주소가 다른 따옴표나 이스케이프로 남아 있으면 실패한다', () => {
  for (const leftover of [`'${A}'`, '`' + A + '`', `"${A.replaceAll('/', '\\/')}"`]) {
    const out = fixture();
    fs.appendFileSync(path.join(out, '_expo/static/js/web', CHUNK), `x=${leftover};`);
    assert.throws(
      () => rewriteReferences(out, new Map([[A, A_WEBP]])),
      (error) =>
        error.message.includes('바꾸지 못한 옛 에셋 주소 1개') && error.message.includes(A),
      leftover,
    );
  }
});

test('작업 하나가 실패하면 새 작업을 시작하지 않고, 돌던 작업이 끝난 뒤 첫 오류를 던진다', async () => {
  const started = [];
  const finished = [];
  const work = async (item) => {
    started.push(item);
    await new Promise((resolve) => setTimeout(resolve, item === 'slow' ? 30 : 1));
    if (item === 'bad') throw new Error('bad');
    finished.push(item);
  };
  await assert.rejects(pool(['bad', 'slow', 'a', 'b', 'c'], 2, work), /bad/);
  assert.deepEqual(started, ['bad', 'slow']);
  assert.deepEqual(finished, ['slow'], '이미 돌던 작업은 끝까지 기다린다');
});
