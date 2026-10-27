import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  openAppLink,
  parseAppDeepLink,
  subscribeToAppLinks,
  type AppLinkSource,
} from './appDeepLink';

const ISLAND_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
const ISSUE_ID = '0197e0c3-9a10-7c3d-8e21-5a6b7c8d9e0f';

test.each([
  ['gromo://home', { kind: 'route', route: 'home' }],
  ['gromo:///focus', { kind: 'route', route: 'focusSetup' }],
  ['gromo://friends', { kind: 'route', route: 'friends' }],
  [
    'gromo://join?g=0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55',
    { kind: 'unsupported', legacyPath: 'join' },
  ],
  ['gromo://group?g=bad', { kind: 'unsupported', legacyPath: 'group' }],
  ['gromo://group', { kind: 'unsupported', legacyPath: 'group' }],
  ['gromo://league', { kind: 'unsupported', legacyPath: 'league' }],
  [`gromo://group?g=${ISLAND_ID}`, { kind: 'island', islandId: ISLAND_ID }],
  // 1.x 챌린지 링크의 나머지 파라미터는 무시하고 섬만 연다.
  [`gromo://group?challenge=${ISSUE_ID}&g=${ISLAND_ID}`, { kind: 'island', islandId: ISLAND_ID }],
  [
    `gromo://group?g=${ISLAND_ID}&challenge=${ISSUE_ID}#top`,
    { kind: 'island', islandId: ISLAND_ID },
  ],
  [`gromo://group?g=${ISLAND_ID.replace('-', '%2D')}`, { kind: 'island', islandId: ISLAND_ID }],
  ['gromo://group?g=%E0%A4%A', { kind: 'unsupported', legacyPath: 'group' }],
  [`gromo://magazine?issue=${ISSUE_ID}`, { kind: 'magazine', issueId: ISSUE_ID }],
  // 대문자 UUID 링크도 서버 id(소문자)로 정규화한다.
  [`gromo://group?g=${ISLAND_ID.toUpperCase()}`, { kind: 'island', islandId: ISLAND_ID }],
  [`gromo://magazine?issue=${ISSUE_ID.toUpperCase()}`, { kind: 'magazine', issueId: ISSUE_ID }],
  ['gromo://magazine', { kind: 'route', route: 'home' }],
  ['gromo://magazine?issue=bad', { kind: 'route', route: 'home' }],
])('%s를 제공 화면 또는 명시적 fallback으로 분류한다', (url, expected) => {
  assert.deepEqual(parseAppDeepLink(url), expected);
});

test.each(['', 'not a url', 'https://example.com/gromo://home', 'gromo://unknown', 'gromo://'])(
  '손상·미지원 링크 %j는 무시한다',
  (url) => assert.equal(parseAppDeepLink(url), null),
);

test('콜드 스타트 URL과 실행 중 URL 이벤트를 전달하고 언마운트 뒤 이벤트를 무시한다', async () => {
  let onUrl!: (event: { url: string }) => void;
  const remove = jest.fn();
  const source = {
    getInitialURL: jest.fn(async () => 'gromo://join?g=group-id'),
    addEventListener: jest.fn((_type, listener) => {
      onUrl = listener;
      return { remove };
    }),
  } as unknown as AppLinkSource;
  const received: string[] = [];
  const unsubscribe = subscribeToAppLinks((url) => received.push(url), source);
  await Promise.resolve();
  assert.deepEqual(received, ['gromo://join?g=group-id']);

  onUrl({ url: 'gromo://group?g=group-id' });
  assert.deepEqual(received, ['gromo://join?g=group-id', 'gromo://group?g=group-id']);

  unsubscribe();
  onUrl({ url: 'gromo://home' });
  assert.deepEqual(received, ['gromo://join?g=group-id', 'gromo://group?g=group-id']);
  expect(remove).toHaveBeenCalledTimes(1);
});

test('초기 URL 조회보다 먼저 온 URL 이벤트를 늦은 초기 URL이 덮지 않는다', async () => {
  let onUrl!: (event: { url: string }) => void;
  let resolveInitial!: (url: string | null) => void;
  const source = {
    getInitialURL: jest.fn(
      () =>
        new Promise<string | null>((resolve) => {
          resolveInitial = resolve;
        }),
    ),
    addEventListener: jest.fn((_type, listener) => {
      onUrl = listener;
      return { remove: jest.fn() };
    }),
  } as unknown as AppLinkSource;
  const received: string[] = [];
  subscribeToAppLinks((url) => received.push(url), source);

  onUrl({ url: 'gromo://friends' });
  resolveInitial('gromo://home');
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(received, ['gromo://friends']);
});

test('앱 안에서 연 링크(푸시 탭)는 구독 중인 소비자에게 가고, 구독을 끊은 소비자에게는 가지 않는다', async () => {
  const source = {
    getInitialURL: jest.fn(async () => null),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  } as unknown as AppLinkSource;
  const received: string[] = [];
  const unsubscribe = subscribeToAppLinks((url) => received.push(url), source);
  await Promise.resolve();

  openAppLink('gromo://friends');
  assert.deepEqual(received, ['gromo://friends']);

  unsubscribe();
  openAppLink('gromo://home');
  assert.deepEqual(received, ['gromo://friends']);
});

test('Android MainActivity가 legacy gromo scheme 링크를 수신한다', () => {
  const manifest = readFileSync(
    path.join(__dirname, '../../android/app/src/main/AndroidManifest.xml'),
    'utf8',
  );
  assert.match(
    manifest,
    /<action android:name="android\.intent\.action\.VIEW"\s*\/>[\s\S]*?<category android:name="android\.intent\.category\.DEFAULT"\s*\/>[\s\S]*?<category android:name="android\.intent\.category\.BROWSABLE"\s*\/>[\s\S]*?<data android:scheme="gromo"\s*\/>/,
  );
});

test('iOS 네이티브 타깃이 legacy gromo scheme 링크를 수신한다', () => {
  const plist = readFileSync(path.join(__dirname, '../../ios/Cattus/Info.plist'), 'utf8');
  const urlTypes = /<key>CFBundleURLTypes<\/key>\s*<array>([\s\S]*?)\n\t<\/array>/.exec(plist)?.[1];
  assert.ok(urlTypes);
  assert.match(urlTypes, /<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>gromo<\/string>/);
});
