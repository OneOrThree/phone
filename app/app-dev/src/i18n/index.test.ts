import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ApiError, CLIENT_TIMEOUT } from '@/services/api/client';
import {
  applyLocalePref,
  errorText,
  errorTextOr,
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

// 앱 쪽 변경 시점의 정합 검사다 — app-lint.yml 은 app/app-dev/** 에서만 돌아 서버만 바뀐 PR 은 여기 안 걸린다.
test('errors 는 business-api ApiErrorCode 의 모든 코드를 가진다 — 서버에 코드가 늘면 여기서 잡힌다', () => {
  const javaPath = path.resolve(
    __dirname,
    '../../../../server/business-api/src/main/java/com/oneorthree/business/common/api/ApiErrorCode.java',
  );
  if (!existsSync(javaPath))
    throw new Error(
      `ApiErrorCode.java 를 찾지 못했다 — 서버가 이동했거나 앱만 체크아웃된 환경이다 (경로: ${javaPath})`,
    );
  const java = readFileSync(javaPath, 'utf8');
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

test('errorTextOr — ko: ApiError 는 원문 그대로, 빈 message·일반 Error·비-Error 는 폴백', () => {
  expect(
    errorTextOr(
      new ApiError('REQUEST_IN_PROGRESS', '처리 중', 409, { retryable: true }),
      'login.error.guestFailed',
    ),
  ).toBe('처리 중'); // errorText 였다면 '처리 중이에요…' 로 덮였을 자리 — ko 는 특수분기를 안 탄다
  expect(errorTextOr(new ApiError('SOME_CODE', '', 400), 'login.error.guestFailed')).toBe(
    ko.login.error.guestFailed,
  );
  // socialLogin 이 t() 로 현지화해 던지는 메시지는 전부 unavailable() 을 거쳐 이미 ApiError 라 위
  // 분기로 들어온다 — ApiError 가 아닌 일반 Error 는 "알 수 없는 실패" 로 보고 폴백으로만 보낸다
  // (여기서 message 를 보여주면 new Error('network') 류 테스트 더블의 원문이 새 나간다, 실측).
  expect(errorTextOr(new Error('network'), 'login.error.guestFailed')).toBe(
    ko.login.error.guestFailed,
  );
  expect(errorTextOr(null, 'login.error.guestFailed')).toBe(ko.login.error.guestFailed);
});

test('errorTextOr — en: ApiError 는 한글이 안 새고 코드별 번역·STALE 은 폴백, 일반 Error 도 폴백', () => {
  applyLocalePref('en');
  expect(
    errorTextOr(
      new ApiError('GOOGLE_TOKEN', '회원 전환 토큰 오류', 422),
      'login.error.guestFailed',
    ),
  ).toBe(en.errors.GOOGLE_TOKEN);
  expect(errorTextOr(stale, 'login.error.guestFailed')).toBe(en.login.error.guestFailed);
  expect(errorTextOr(new Error('network'), 'login.error.guestFailed')).toBe(
    en.login.error.guestFailed,
  );
});

test('localized — 현재 언어 값을 고르고, 없으면 en 값', () => {
  expect(localized({ ko: '한국어 그림', en: 'English art' })).toBe('한국어 그림');
  applyLocalePref('en');
  expect(localized({ ko: '한국어 그림', en: 'English art' })).toBe('English art');
  applyLocalePref('ko');
  expect(localized<string | undefined>({ ko: undefined, en: 'English art' })).toBe('English art');
});
