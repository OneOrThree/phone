// 기기 로케일 → 지원 언어 판정. 번체/간체 갈림길이 이 함수의 유일한 로직이라 여기만 잠근다.
import { resolveLocale } from './index';

const mockLocales = jest.requireMock('expo-localization').getLocales as jest.Mock;

function device(locale: Partial<Record<string, string | null>>) {
  mockLocales.mockReturnValue([locale]);
}

afterEach(() => {
  mockLocales.mockReturnValue([
    { languageCode: 'ko', languageTag: 'ko-KR', regionCode: 'KR', languageScriptCode: null },
  ]);
});

test('한국어·일본어는 그대로 매핑된다', () => {
  device({ languageCode: 'ko', regionCode: 'KR' });
  expect(resolveLocale()).toBe('ko');
  device({ languageCode: 'ja', regionCode: 'JP' });
  expect(resolveLocale()).toBe('ja');
});

test('중국어는 스크립트 코드가 있으면 그걸로 번체/간체를 가른다', () => {
  device({ languageCode: 'zh', languageScriptCode: 'Hant', regionCode: 'TW' });
  expect(resolveLocale()).toBe('zh-Hant');
  // 간체는 미지원 — 한글이 아니라 영어로 떨어뜨린다.
  device({ languageCode: 'zh', languageScriptCode: 'Hans', regionCode: 'CN' });
  expect(resolveLocale()).toBe('en');
});

test('스크립트 코드가 없으면 지역으로 번체를 추정한다', () => {
  for (const regionCode of ['TW', 'HK', 'MO']) {
    device({ languageCode: 'zh', regionCode });
    expect(resolveLocale()).toBe('zh-Hant');
  }
  device({ languageCode: 'zh', regionCode: 'CN' });
  expect(resolveLocale()).toBe('en');
});

test('지원하지 않는 언어와 로케일 부재는 영어로 떨어진다', () => {
  device({ languageCode: 'fr', regionCode: 'FR' });
  expect(resolveLocale()).toBe('en');
  mockLocales.mockReturnValue([]);
  expect(resolveLocale()).toBe('en');
});
