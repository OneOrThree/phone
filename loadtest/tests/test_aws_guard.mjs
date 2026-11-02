import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { assertNotAwsTarget } from '../k6/lib/aws-guard.mjs';

// [입력, 오류 메시지에 담기는 호스트]
const denied = [
  ['https://catus-api-v2.oneorthree.world', 'catus-api-v2.oneorthree.world'],
  ['https://x.amazonaws.com', 'x.amazonaws.com'],
  ['https://d1.cloudfront.net', 'd1.cloudfront.net'],
  ['HTTPS://CATUS-API.ONEORTHREE.WORLD/', 'catus-api.oneorthree.world'],
  // 우회 시도: 정점 도메인, 포트·경로, localhost 로 가장한 userinfo, 끝 점(FQDN)
  ['https://oneorthree.world', 'oneorthree.world'],
  ['https://catus-api-v2.oneorthree.world:443/api/v1', 'catus-api-v2.oneorthree.world'],
  ['https://localhost:8080@catus-api-v2.oneorthree.world/', 'catus-api-v2.oneorthree.world'],
  ['https://catus-api-v2.oneorthree.world./', 'catus-api-v2.oneorthree.world'],
];

const allowed = [
  'http://localhost:8080', // config.js 기본값
  'http://10.0.0.5:8080', // run.sh 가 넘기는 GCP 내부 SUT 주소 형태
  'https://oneorthree-v2.dev.mooo.com', // GCP dev
  'https://notoneorthree.world.example', // 단순 포함 검사였다면 걸렸을 이름
  'https://notoneorthree.world', // 끝만 비교했다면 걸렸을 이름 — '.' 로 앵커한다
  'http://[::1]:8080',
  'http://localhost:8080/?next=https://x.amazonaws.com', // 금지 호스트가 쿼리에만 있다
];

test('AWS 호스트와 그 서브도메인은 대소문자·포트·userinfo·끝 점과 무관하게 거부한다', () => {
  for (const [url, host] of denied) {
    assert.throws(() => assertNotAwsTarget(url), { message: `AWS 대상 부하 금지(2026-10-29): ${host}` }, url);
  }
});

test('그 밖의 주소는 통과하고 값을 그대로 돌려준다', () => {
  for (const url of allowed) assert.equal(assertNotAwsTarget(url), url);
});

test('BASE_URL 은 config.js 한 곳에서만 읽고 가드를 거친다', () => {
  const k6 = new URL('../k6/', import.meta.url);
  const readers = readdirSync(k6, { recursive: true })
    .filter(file => /\.m?js$/.test(file))
    .filter(file => /__ENV\W+BASE_URL/.test(readFileSync(new URL(file, k6), 'utf8')));
  assert.deepEqual(readers, ['lib/config.js']);
  assert.match(readFileSync(new URL('lib/config.js', k6), 'utf8'), /export const BASE_URL = assertNotAwsTarget\(/);
});
