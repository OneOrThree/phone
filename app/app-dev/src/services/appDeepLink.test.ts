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

test('구독 전에 온 지연 딥링크를 한 번 전달하고 늦은 초기 URL로 덮지 않는다', async () => {
  jest.resetModules();
  const links = require('./appDeepLink') as typeof import('./appDeepLink');
  links.openAirbridgeLink('gromo://friends');
  const source = {
    getInitialURL: jest.fn(async () => 'gromo://home'),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  } as unknown as AppLinkSource;
  const received: string[] = [];
  const stop = links.subscribeToAppLinks((url) => received.push(url), source);
  await Promise.resolve();
  expect(received).toEqual(['gromo://friends']);
  stop();
  const next: string[] = [];
  const stopNext = links.subscribeToAppLinks((url) => next.push(url), source);
  await Promise.resolve();
  expect(next).toEqual(['gromo://home']);
  stopNext();
});

test('OS·SDK 중복 링크는 한 번만 이동하고 이후 다시 탭한 링크는 허용한다', async () => {
  jest.resetModules();
  const links = require('./appDeepLink') as typeof import('./appDeepLink');
  let onUrl!: (event: { url: string }) => void;
  const source = {
    getInitialURL: jest.fn(async () => null),
    addEventListener: jest.fn((_type, listener) => {
      onUrl = listener;
      return { remove: jest.fn() };
    }),
  } as unknown as AppLinkSource;
  const now = jest.spyOn(Date, 'now').mockReturnValue(10000);
  const received: string[] = [];
  const stop = links.subscribeToAppLinks((url) => received.push(url), source);
  onUrl({ url: 'gromo://friends?airbridge_referrer=test' });
  links.openAirbridgeLink('gromo://friends');
  links.openAirbridgeLink('https://untrusted.example/path');
  expect(received).toHaveLength(1);
  now.mockReturnValue(12000);
  links.openAirbridgeLink('gromo://friends');
  expect(received).toHaveLength(2);
  stop();
  now.mockRestore();
});

test.each([
  ['https://link.oneorthree.world/l/abcdefgh?g=ignored', 'abcdefgh'],
  ['https://catus-api-v2.oneorthree.world/l/abcdefgh?g=ignored', 'abcdefgh'],
  ['https://oneorthree-v2.dev.mooo.com/l/abcdefgh', 'abcdefgh'],
  ['gromo://join?g=ignored&s=abcdefgh', 'abcdefgh'],
  // Infra V2 nginx 초대 랜딩의 «앱에서 열기» 버튼이 쓰는 주소(prod/catus-v2/runtime/nginx.conf-V2.template).
  ['gromo://join?s=abcdefgh', 'abcdefgh'],
])('초대 링크 %s는 서버 확인용 코드만 반환한다', (url, code) => {
  expect(parseAppDeepLink(url)).toEqual({ kind: 'invitation', code });
});
test.each([
  'https://link.oneorthree.world.evil.com/l/abcdefgh',
  // 삭제한 옛 dev VM 호스트(GROMO-2661)는 더는 초대 호스트가 아니다.
  'https://oneorthree.dev.mooo.com/l/abcdefgh',
  'https://link.oneorthree.world/l/abcdefgh/extra',
  'https://link.oneorthree.world/l/invalid',
  // 운영 V2 호스트는 앱 API 도 서빙한다. /l/<슬러그> 만 초대이고 같은 호스트의 다른 경로는 초대가 아니다.
  'https://catus-api-v2.oneorthree.world/me',
  'https://catus-api-v2.oneorthree.world/health',
  'https://catus-api-v2.oneorthree.world/ws/realtime',
  'https://catus-api-v2.oneorthree.world/invite-links/claim',
  'https://catus-api-v2.oneorthree.world/groups/abcdefgh/invite-link',
  'https://catus-api-v2.oneorthree.world/l/match',
  'https://catus-api-v2.oneorthree.world/abcdefgh',
  'https://catus-api-v2.oneorthree.world/x/l/abcdefgh',
  'https://catus-api-v2.oneorthree.world/l/abcdefgh/extra',
  'https://catus-api-v2.oneorthree.world/l/abcdefgh/',
  'https://catus-api-v2.oneorthree.world.evil.com/l/abcdefgh',
  'https://evil.example/catus-api-v2.oneorthree.world/l/abcdefgh',
  'http://catus-api-v2.oneorthree.world/l/abcdefgh',
])('잘못된 초대 URL %s는 무시한다', (url) => {
  expect(parseAppDeepLink(url)).toBeNull();
});

// 초대 URL 을 받는 호스트는 파서·iOS Associated Domains·Android App Links·expo 설정이 같아야 한다.
// 한 곳만 빠지면 OS 가 링크를 앱으로 넘기지 않거나, 넘겨도 앱이 버린다.
test.each(['link.oneorthree.world', 'catus-api-v2.oneorthree.world', 'oneorthree-v2.dev.mooo.com'])(
  '초대 호스트 %s를 파서와 네이티브·expo 설정이 함께 받는다',
  (host) => {
    const read = (file: string) => readFileSync(path.join(__dirname, '../..', file), 'utf8');
    const { expo } = require('../../app.config');
    expect(parseAppDeepLink(`https://${host}/l/abcdefgh`)).toEqual({
      kind: 'invitation',
      code: 'abcdefgh',
    });
    expect(read('ios/Cattus/Cattus.entitlements')).toContain(`<string>applinks:${host}</string>`);
    // autoVerify 필터 안, /l/ 로만 좁힌 형태여야 한다. 호스트 전체를 받으면 API 주소까지 앱으로 열린다.
    expect(read('android/app/src/main/AndroidManifest.xml')).toMatch(
      new RegExp(
        `<intent-filter android:autoVerify="true">(?:(?!</intent-filter>)[\\s\\S])*android:host="${host.replace(/\./g, '\\.')}" android:pathPrefix="/l/"/>`,
      ),
    );
    expect(expo.ios.associatedDomains).toContain(`applinks:${host}`);
    expect(expo.android.intentFilters).toContainEqual({
      action: 'VIEW',
      autoVerify: true,
      category: ['BROWSABLE', 'DEFAULT'],
      data: [{ scheme: 'https', host, pathPrefix: '/l/' }],
    });
  },
);
