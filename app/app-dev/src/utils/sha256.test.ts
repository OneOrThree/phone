import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256Hex } from '@/utils/sha256';

const enc = (s: string) => new TextEncoder().encode(s);

test('표준 벡터: 빈 입력·abc', () => {
  assert.equal(
    sha256Hex(enc('')),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  assert.equal(
    sha256Hex(enc('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('블록 경계(55·56·64·65바이트)와 큰 입력이 node crypto 와 같다', () => {
  for (const n of [55, 56, 63, 64, 65, 119, 120, 1000, 200_003]) {
    const buf = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 0xff);
    assert.equal(sha256Hex(buf), createHash('sha256').update(buf).digest('hex'), `n=${n}`);
  }
});
