import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseAppDeepLink, subscribeToAppLinks, type AppLinkSource } from './appDeepLink';

test.each([
  ['gromo://home', { kind: 'route', route: 'home' }],
  ['gromo:///focus', { kind: 'route', route: 'focusSetup' }],
  ['gromo://friends', { kind: 'route', route: 'friends' }],
  [
    'gromo://join?g=0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55',
    { kind: 'unsupported', legacyPath: 'join' },
  ],
  ['gromo://group?g=bad', { kind: 'unsupported', legacyPath: 'group' }],
  ['gromo://league', { kind: 'unsupported', legacyPath: 'league' }],
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
  const plist = readFileSync(path.join(__dirname, '../../ios/GROMO/Info.plist'), 'utf8');
  const urlTypes = /<key>CFBundleURLTypes<\/key>\s*<array>([\s\S]*?)\n\t<\/array>/.exec(plist)?.[1];
  assert.ok(urlTypes);
  assert.match(urlTypes, /<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>gromo<\/string>/);
});
