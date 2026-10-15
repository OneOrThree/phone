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

// leaves() 와 같은 리프 판정으로, 자리표시자 집합 대신 실제 값(문자열 또는 { one, other })을 모은다 —
// 아래 건전성 테스트 전용.
function leafValues(node: any, prefix = ''): Record<string, unknown> {
  if (typeof node === 'string' || 'other' in node) return { [prefix]: node };
  return Object.assign(
    {},
    ...Object.entries(node).map(([k, v]) => leafValues(v, prefix ? `${prefix}.${k}` : k)),
  );
}

const newlineCount = (s: string): number => (s.match(/\n/g) ?? []).length;

test('로케일 건전성 — ko·en 의 모든 문자열 리프는 trim 해도 빈 문자열이 아니다', () => {
  for (const [table, name] of [
    [ko, 'ko'],
    [en, 'en'],
  ] as const) {
    const blank = Object.entries(leafValues(table))
      .filter(([, v]) => typeof v === 'string' && v.trim() === '')
      .map(([k]) => `${name}.${k}`);
    expect(blank).toEqual([]);
  }
});

test('로케일 건전성 — 복수 객체({ one, other })는 둘 다 문자열이다', () => {
  for (const [table, name] of [
    [ko, 'ko'],
    [en, 'en'],
  ] as const) {
    const bad = Object.entries(leafValues(table))
      .filter(([, v]) => typeof v === 'object' && v !== null)
      .filter(([, v]) => typeof (v as any).one !== 'string' || typeof (v as any).other !== 'string')
      .map(([k]) => `${name}.${k}`);
    expect(bad).toEqual([]);
  }
});

test('로케일 건전성 — en 의 어떤 문자열에도 한글이 섞이지 않는다', () => {
  const leaked = Object.entries(leafValues(en)).flatMap(([k, v]) => {
    const parts: [string, unknown][] =
      typeof v === 'string'
        ? [[k, v]]
        : [
            [`${k}.one`, (v as any).one],
            [`${k}.other`, (v as any).other],
          ];
    return parts
      .filter(([, s]) => typeof s === 'string' && /[가-힣]/.test(s))
      .map(([leafKey]) => leafKey);
  });
  expect(leaked).toEqual([]);
});

test('로케일 건전성 — 같은 키의 ko·en 값은 줄바꿈(\\n) 개수가 같다(ko 문자열 vs en 복수는 other 와 비교)', () => {
  const koValues = leafValues(ko);
  const enValues = leafValues(en);
  // ko 리프는 관례상 항상 문자열이다(README) — ko 가 복수 객체인 변칙 모양은 위 ②가 잡는다.
  const mismatched = Object.keys(koValues).filter((key) => {
    const k = koValues[key];
    const e = enValues[key];
    if (typeof k !== 'string') return false;
    if (typeof e === 'string') return newlineCount(k) !== newlineCount(e);
    if (e && typeof e === 'object') return newlineCount(k) !== newlineCount((e as any).other ?? '');
    return false;
  });
  expect(mismatched).toEqual([]);
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

test('errorText — ko 는 한글 message 에 한해 기존 serverErrorText 와 글자까지 같다', () => {
  expect(inputs.map(errorText)).toEqual(inputs.map(serverErrorText));
});

// 위 패리티는 ko 고정 fixture(inputs)가 전부 한글 message 라 성립한다 — serverErrorText 는 언어를
// 안 가리고 message 를 그대로 돌려주지만(FORBIDDEN 분기), 실제 errorText 는 koText 로 한글 아니면
// 거른다. 영문 message 가 섞이면 둘이 갈라지는 자리를 여기서 따로 고정한다.
test('errorText·errorTextOr — ko 에서도 영문 message 는 FORBIDDEN·REQUEST_IN_PROGRESS·폴백 분기 모두에서 거른다', () => {
  applyLocalePref('ko');
  expect(errorText(new ApiError('FORBIDDEN', 'Forbidden', 403))).toBe(t('errors.GENERIC'));
  expect(
    errorText(new ApiError('REQUEST_IN_PROGRESS', 'In progress', 409, { retryable: true })),
  ).toBe(t('errors.REQUEST_IN_PROGRESS'));
  expect(errorTextOr(new ApiError('SOME_CODE', 'Some english message', 400), 'common.retry')).toBe(
    t('common.retry'),
  );
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

// socialLogin.ts 가 웹·Apple 비지원 플랫폼·빈 토큰에서 t() 로 이미 현지화해 던지는 메시지 — 서버
// message 규칙(ko 만 원문)의 예외라 en 에서도 그대로 보존돼야 한다(errors.CLIENT_PROVIDER_UNAVAILABLE
// 키는 en 에 없다, GROMO-2235 PR #1098 codex 지적).
test('errorText·errorTextOr — CLIENT_PROVIDER_UNAVAILABLE 은 en 에서도 socialLogin 이 만든 message 를 그대로 보존한다', () => {
  applyLocalePref('en');
  const err = new ApiError(
    'CLIENT_PROVIDER_UNAVAILABLE',
    'Apple sign-in is only available on iPhone and iPad',
    0,
  );
  expect(errorText(err)).toBe('Apple sign-in is only available on iPhone and iPad');
  expect(errorTextOr(err, 'common.retry')).toBe(
    'Apple sign-in is only available on iPhone and iPad',
  );
});

test('errorText·errorTextOr — ko 분기는 한글 없는 서버 message(예: Spring 기본 "Not Found")를 거르고, 한글+숫자가 섞인 message는 그대로 돌려준다', () => {
  const notFound = new ApiError('SOME_CODE', 'Not Found', 400);
  expect(errorTextOr(notFound, 'common.retry')).toBe(t('common.retry'));
  expect(errorText(notFound)).toBe(t('errors.GENERIC'));

  const mixed = new ApiError('SOME_CODE', '요청이 너무 많아요 (429)', 400);
  expect(errorText(mixed)).toBe('요청이 너무 많아요 (429)');
});

test('localized — 현재 언어 값을 고르고, 없으면 en 값', () => {
  expect(localized({ ko: '한국어 그림', en: 'English art' })).toBe('한국어 그림');
  applyLocalePref('en');
  expect(localized({ ko: '한국어 그림', en: 'English art' })).toBe('English art');
  applyLocalePref('ko');
  expect(localized<string | undefined>({ ko: undefined, en: 'English art' })).toBe('English art');
});
