import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { findMissingReferences, rewriteReferences } from './optimize-assets.cjs';

const hash = (text) => crypto.createHash('md5').update(text).digest('hex');
const A = '/assets/src/assets/a.' + hash('a') + '.png';
const B = '/assets/src/assets/b.' + hash('b') + '.png';
const A_WEBP = '/assets/src/assets/a.' + hash('a-webp') + '.webp';
const CHUNK = `index-${hash('chunk')}.js`;
const MAIN = `index-${hash('main')}.js`;

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

test('번들에 없는 주소를 바꾸라고 하면 실패한다', () => {
  const out = fixture();
  assert.throws(
    () => rewriteReferences(out, new Map([['/assets/src/assets/none.png', A_WEBP]])),
    /에셋 참조 0곳/,
  );
});

test('번들이 가리키는 에셋이 없으면 찾아낸다', () => {
  const out = fixture();
  fs.rmSync(path.join(out, B));
  assert.deepEqual(findMissingReferences(out), [B]);
});
