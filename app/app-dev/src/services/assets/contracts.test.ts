import { buildPublisherManifest } from './__fixtures__/publisherManifest';
import { AssetFile, Manifest, canonical, digest, parseManifest } from './contracts';
import { POLICY } from './policy';

const real = buildPublisherManifest();
const [headId] = Object.keys(real.packs['customization-head'].files);
const [rigId] = Object.keys(real.packs['customization-rigs'].files);
const target = {
  hall: ['interior-hall', 'background'],
  png: ['customization-head', headId],
  rig: ['customization-rigs', rigId],
} as const;

// 파일 하나만 바꾼 사본. 팩 version 은 바뀐 files 의 digest 로 다시 맞춘다 — 안 맞추면 모든 변조가
// 'pack schema' 에서 먼저 걸려 파일 검사가 실제로 거부하는지 볼 수 없다.
// 바꾸기 전 사본은 통과해야 한다 — 아니면 아래 거부 테스트가 변조가 아닌 다른 이유로 초록이 된다.
function changed(which: keyof typeof target, patch: (f: AssetFile) => Record<string, unknown>) {
  const [packId, assetId] = target[which];
  const m = buildPublisherManifest();
  parseManifest(m);
  const pack = m.packs[packId];
  pack.files[assetId] = { ...pack.files[assetId], ...patch(pack.files[assetId]) } as AssetFile;
  pack.version = digest(canonical(pack.files));
  return m;
}
const sha8 = (f: AssetFile) => f.sha256.slice(0, 8);

test('발행기가 만든 manifest 를 받는다 — 회관 PNG, 꾸미기 정적 경로 PNG, rig JSON 이 한 manifest 에 있다', () => {
  const m = buildPublisherManifest();
  const all = Object.values(m.packs).flatMap((p) => Object.values(p.files));
  // 발행기가 조용히 PNG 만 내면 이 테스트는 아무것도 검증하지 못한다 — 보려는 세 모양이 실제로 나왔는지 먼저 본다.
  expect(all.some((f) => f.mediaType === 'image/png' && f.path.startsWith('assets/'))).toBe(true);
  expect(
    all.some((f) => f.mediaType === 'image/png' && f.path.startsWith('static/customization/')),
  ).toBe(true);
  expect(
    all.some(
      (f) => f.mediaType === 'application/json' && f.path.startsWith('static/customization/'),
    ),
  ).toBe(true);
  expect(parseManifest(m)).toEqual(m);
});

test('내용 해시 경로의 JSON 도 받는다 — 발행기 validateManifest 가 허용하는 형태다', () => {
  const m = changed('rig', (f) => ({ path: `assets/${f.sha256}.json` }));
  expect(parseManifest(m)).toEqual(m);
});

test.each<[string, keyof typeof target, (f: AssetFile) => string]>([
  ['상위 경로', 'png', (f) => `static/customization/head/../x.${sha8(f)}.png`],
  ['절대 경로', 'png', (f) => `/static/customization/head/x.${sha8(f)}.png`],
  ['절대 URL', 'png', (f) => `https://evil.example/static/customization/head/x.${sha8(f)}.png`],
  ['query', 'png', (f) => `static/customization/head/x.${sha8(f)}.png?token=1`],
  ['fragment', 'png', (f) => `static/customization/head/x.${sha8(f)}.png#top`],
  ['퍼센트 인코딩', 'png', (f) => `static/customization/head/%2e%2e%2fx.${sha8(f)}.png`],
  ['허용 밖 분류', 'png', (f) => `static/customization/evil/x.${sha8(f)}.png`],
  ['하위 디렉터리', 'png', (f) => `static/customization/head/sub/x.${sha8(f)}.png`],
  ['내용과 다른 해시 접두', 'png', () => 'static/customization/head/x.deadbeef.png'],
  ['확장자와 mediaType 불일치', 'png', (f) => `static/customization/head/x.${sha8(f)}.json`],
  ['rig 확장자와 mediaType 불일치', 'rig', (f) => `static/customization/rigs/x.${sha8(f)}.png`],
  ['다른 파일의 해시 경로', 'png', () => `assets/${'a'.repeat(64)}.png`],
  ['해시 경로의 상위 경로', 'hall', () => '../escape.png'],
])('경로 규칙은 유지한다 — %s 는 거부한다', (_name, which, path) => {
  const m = changed(which, (f) => ({ path: path(f) }));
  expect(() => parseManifest(m)).toThrow('file schema');
});

test.each<[string, keyof typeof target, Record<string, unknown>]>([
  ['내용 해시가 경로와 다르다', 'hall', { sha256: 'f'.repeat(64) }],
  ['대문자 해시', 'hall', { sha256: 'A'.repeat(64) }],
  ['짧은 해시', 'png', { sha256: 'abc' }],
  ['image/jpeg', 'png', { mediaType: 'image/jpeg' }],
  ['image/svg+xml', 'png', { mediaType: 'image/svg+xml' }],
  ['text/html', 'rig', { mediaType: 'text/html' }],
  ['application/javascript', 'rig', { mediaType: 'application/javascript' }],
  ['mediaType 없음', 'png', { mediaType: undefined }],
])('해시와 mediaType 허용 목록은 유지한다 — %s 는 거부한다', (_name, which, patch) => {
  const m = changed(which, () => patch);
  expect(() => parseManifest(m)).toThrow('file schema');
});

test.each<[string, keyof typeof target, Record<string, unknown>]>([
  ['PNG 16MiB 초과', 'hall', { bytes: POLICY.fileBytes + 1 }],
  ['JSON 16MiB 초과', 'rig', { bytes: POLICY.fileBytes + 1 }],
  ['0바이트', 'png', { bytes: 0 }],
  ['정수가 아닌 크기', 'png', { bytes: 1.5 }],
  ['문자열 크기', 'png', { bytes: '10' }],
  ['PNG 가로 4096 초과', 'hall', { width: 4097 }],
  ['PNG 세로 0', 'hall', { height: 0 }],
  ['PNG 치수 없음', 'png', { width: undefined, height: undefined }],
  ['JSON 에 치수가 붙음', 'rig', { width: 10, height: 10 }],
])('상한은 약화하지 않는다 — %s 는 거부한다', (_name, which, patch) => {
  const m = changed(which, () => patch);
  expect(() => parseManifest(m)).toThrow('file schema');
});

test('팩 합계 32MiB 초과와 팩당 파일 128개 초과는 거부한다', () => {
  const big = buildPublisherManifest();
  const pack = big.packs['customization-head'];
  for (const f of Object.values(pack.files)) f.bytes = 4 * 1024 ** 2;
  pack.version = digest(canonical(pack.files));
  expect(() => parseManifest(big)).toThrow('manifest limit');

  const many = buildPublisherManifest();
  const rigs = many.packs['customization-rigs'];
  const [first] = Object.values(rigs.files);
  for (let i = 0; i < 129; i++) rigs.files[`extra-${i}`] = first;
  rigs.version = digest(canonical(rigs.files));
  expect(() => parseManifest(many)).toThrow('pack schema');
});

test('팩 version 이 files 의 digest 와 다르면 거부한다', () => {
  const m: Manifest = buildPublisherManifest();
  m.packs['interior-hall'].version = 'e'.repeat(64);
  expect(() => parseManifest(m)).toThrow('pack schema');
});
