// 준비 시험 표시명(shared.focusCategories.name.<CODE>) 정합성 — GROMO-1704.
//
// 이 키가 빠지면 occupationCatalog.displayNameOf 가 서버 displayName(한국어)으로
// 조용히 떨어진다. 화면은 멀쩡히 뜨고 글자만 한국어라, 그 화면을 그 언어로 열어보기
// 전까지 아무도 모른다. 타입 검사로도 안 잡힌다 — 키가 문자열 조합이라서다.
//
// code 축(OCCUPATION_GROUPS 가 19종을 전수 커버하는지)은 GROMO-1624 의
// focusCategories.consistency.test.ts 가 본다. 여기는 표시명 축만 본다.
import { OCCUPATION_GROUPS } from '@/constants/focusCategories';
import en from './locales/en.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import zhHant from './locales/zh-Hant.json';

const LOCALES = { ko, en, ja, 'zh-Hant': zhHant };
const CODES = OCCUPATION_GROUPS.flatMap((g) => g.codes);

describe.each(Object.entries(LOCALES))('%s', (_lang, bundle) => {
  const names = (bundle as { shared: { focusCategories: { name: Record<string, string> } } }).shared
    .focusCategories.name;

  test('19종 전 code 에 표시명이 있고 비어 있지 않다', () => {
    const missing = CODES.filter((code) => !names[code]?.trim());
    expect(missing).toEqual([]);
  });

  test('쓰이지 않는 표시명 키가 없다', () => {
    expect(Object.keys(names).sort()).toEqual([...CODES].sort());
  });
});
