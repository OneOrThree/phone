import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ApiError, CLIENT_TIMEOUT } from '@/services/api/client';
import {
  applyLocalePref,
  errorText,
  getLocale,
  getLocalePref,
  localized,
  resolveLocale,
  t,
} from './index';
import en from './locales/en.json';
import ko from './locales/ko.json';

const mockLocales = jest.requireMock('expo-localization').getLocales as jest.Mock;

afterEach(() => applyLocalePref('system'));

// 리프(문자열, 또는 en 복수 { one, other }) 경로 → 그 리프의 {{var}} 자리표시자 집합.
function leaves(node: any, prefix = ''): Record<string, string[]> {
  if (typeof node === 'string' || 'other' in node)
    return { [prefix]: [...new Set(JSON.stringify(node).match(/\{\{\w+\}\}/g))].sort() };
  return Object.assign(
    {},
    ...Object.entries(node).map(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k)),
  );
}

test('ko·en 은 같은 리프 키와 같은 {{var}} 자리표시자를 가진다', () => {
  expect(leaves(ko)).toEqual(leaves(en));
});

test('errors 는 business-api ApiErrorCode 의 모든 코드를 가진다 — 서버에 코드가 늘면 여기서 잡힌다', () => {
  const java = readFileSync(
    path.resolve(
      __dirname,
      '../../../../server/business-api/src/main/java/com/oneorthree/business/common/api/ApiErrorCode.java',
    ),
    'utf8',
  );
  const names = [...java.matchAll(/^\s*([A-Z_][A-Z_0-9]*)\(/gm)].map((m) => m[1]);
  // 2026-10-08 기준 45건 — 정규식이 조용히 덜 뽑아 통과하는 것을 막는다.
  expect(names.length).toBeGreaterThanOrEqual(45);
  expect(names.filter((name) => !(name in ko.errors && name in en.errors))).toEqual([]);
});

test('resolveLocale — 기기 언어가 한국어면 ko, 그 밖의 언어·로케일 부재는 en', () => {
  mockLocales.mockReturnValueOnce([{ languageCode: 'ko', languageTag: 'ko-KR' }]);
  expect(resolveLocale()).toBe('ko');
  mockLocales.mockReturnValueOnce([{ languageCode: 'en', languageTag: 'en-US' }]);
  expect(resolveLocale()).toBe('en');
  mockLocales.mockReturnValueOnce([{ languageCode: 'ja', languageTag: 'ja-JP' }]);
  expect(resolveLocale()).toBe('en');
  mockLocales.mockReturnValueOnce([]);
  expect(resolveLocale()).toBe('en');
});

test('applyLocalePref — 지원 언어만 그대로 두고 나머지는 system(기기 언어)으로 정규화한다', () => {
  expect(applyLocalePref('en')).toBe('en');
  expect([getLocale(), getLocalePref()]).toEqual(['en', 'en']);
  expect(applyLocalePref('ko')).toBe('ko');
  expect([getLocale(), getLocalePref()]).toEqual(['ko', 'ko']);
  for (const raw of ['ja', 'zh-Hant', null]) {
    expect(applyLocalePref(raw)).toBe('system');
    expect([getLocale(), getLocalePref()]).toEqual(['ko', 'system']); // 목 기기 언어 ko-KR
  }
  mockLocales.mockReturnValueOnce([{ languageCode: 'en', languageTag: 'en-US' }]);
  expect(applyLocalePref(null)).toBe('system');
  expect(getLocale()).toBe('en');
});

test('t — {{var}} 치환, 없는 변수는 빈 문자열', () => {
  expect(t('time.hoursMinutes', { h: 1, m: 5 })).toBe('1시간 5분');
  expect(t('time.minutes')).toBe('분');
  applyLocalePref('en');
  expect(t('time.hoursMinutes', { h: 1, m: 5 })).toBe('1h 5m');
});

test('t — en 복수는 count 로 one/other, ko 에 없는 키는 en, 어디에도 없는 키는 키 그대로', () => {
  // 실제 표엔 아직 복수·ko 누락 키가 없어(키 집합 동치 테스트) 표를 갈아 끼운 새 모듈로 본다.
  let i18n!: typeof import('./index');
  jest.isolateModules(() => {
    jest.doMock('./locales/ko.json', () => ({ island: { count: '섬 {{count}}개' } }));
    jest.doMock('./locales/en.json', () => ({
      island: { count: { one: '{{count}} island', other: '{{count}} islands' }, enOnly: 'Only en' },
    }));
    i18n = require('./index');
  });
  i18n.applyLocalePref('en');
  expect(i18n.t('island.count', { count: 1 })).toBe('1 island');
  expect(i18n.t('island.count', { count: 2 })).toBe('2 islands');
  i18n.applyLocalePref('ko');
  expect(i18n.t('island.count', { count: 2 })).toBe('섬 2개');
  expect(i18n.t('island.enOnly')).toBe('Only en');
  expect(i18n.t('island.missing')).toBe('island.missing');
});

// Screens.tsx serverErrorText 원본 그대로 — errorText 의 ko 출력은 이것과 글자까지 같아야 한다.
const serverErrorText = (thrown: unknown) => {
  if (!(thrown instanceof ApiError)) return '연결을 확인한 뒤 다시 시도해 주세요.';
  const code = thrown.code;
  if (code === 'CLIENT_STALE_SESSION') return '';
  if (code === 'SLUG_NOT_FOUND') return '초대 코드를 다시 확인해 주세요.';
  if (code === 'INVITATION_EXPIRED') return '만료된 초대예요. 새 초대를 받아 주세요.';
  if (code === 'FORBIDDEN' && thrown.message) return thrown.message;
  if (code === 'STATE_CONFLICT' || code === 'VERSION_CONFLICT')
    return '섬 정보가 바뀌었어요. 최신 상태로 다시 시도해 주세요.';
  if (code === 'REQUEST_IN_PROGRESS' || thrown.retryable)
    return '처리 중이에요. 잠시 뒤 다시 시도해 주세요.';
  return thrown.message || '연결을 확인한 뒤 다시 시도해 주세요.';
};
const stale = new ApiError(
  'CLIENT_STALE_SESSION',
  '로그인 정보가 바뀌었어요. 다시 시도해 주세요.',
  0,
);
const unknownCode = new ApiError('NEW_SERVER_CODE', '서버가 새로 보낸 문구예요.', 400);
const inputs: unknown[] = [
  new Error('네트워크 끊김'),
  stale,
  new ApiError('SLUG_NOT_FOUND', '초대 링크를 찾을 수 없습니다.', 404),
  new ApiError('INVITATION_EXPIRED', '초대가 만료되었거나 폐기되었습니다.', 410),
  new ApiError('FORBIDDEN', '방장만 할 수 있어요.', 403),
  new ApiError('FORBIDDEN', '', 403),
  new ApiError('STATE_CONFLICT', '현재 상태에서는 이 작업을 수행할 수 없습니다.', 409),
  new ApiError('VERSION_CONFLICT', '상태가 변경되었습니다. 최신 내용을 확인해 주세요.', 409),
  new ApiError('REQUEST_IN_PROGRESS', '요청을 처리 중입니다.', 409, { retryable: true }),
  new ApiError('RATE_LIMITED', '요청이 많습니다. 잠시 후 다시 시도해 주세요.', 429, {
    retryable: true,
  }),
  new ApiError('NICKNAME_INVALID', '닉네임은 앞뒤 공백 제외 2~10자여야 합니다.', 400),
  unknownCode,
  new ApiError('NEW_SERVER_CODE', '', 400),
  new ApiError(CLIENT_TIMEOUT, '서버 응답이 늦어요. 잠시 후 다시 시도해 주세요.', 0),
];

test('errorText — ko 는 기존 serverErrorText 와 글자까지 같다', () => {
  expect(inputs.map(errorText)).toEqual(inputs.map(serverErrorText));
});

test('errorText — en 은 어떤 경로로도 서버 한글 문구를 내보내지 않는다', () => {
  applyLocalePref('en');
  expect(inputs.map(errorText).filter((text) => /[가-힣]/.test(text))).toEqual([]);
  expect(errorText(stale)).toBe('');
  expect(errorText(unknownCode)).toBe(en.errors.GENERIC);
  expect(errorText(inputs[4])).toBe(en.errors.FORBIDDEN);
  expect(errorText(inputs[10])).toBe(en.errors.NICKNAME_INVALID);
});

test('localized — 현재 언어 값을 고르고, 없으면 en 값', () => {
  expect(localized({ ko: '한국어 그림', en: 'English art' })).toBe('한국어 그림');
  applyLocalePref('en');
  expect(localized({ ko: '한국어 그림', en: 'English art' })).toBe('English art');
  applyLocalePref('ko');
  expect(localized<string | undefined>({ ko: undefined, en: 'English art' })).toBe('English art');
});
