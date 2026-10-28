/**
 * 서버 길이 제한은 코드포인트로 센다(🐟 = 1). `string.length`·`TextInput maxLength` 는 UTF-16 이라 🐟 가 2로 세어
 * 서버가 받아 주는 글을 앱이 막는다 — 입력 제한·글자 수 표시는 이 둘로 한다(GROMO-2263).
 */
export const codePointLength = (value: string): number => Array.from(value).length;

/** 코드포인트 `max` 개까지만 남긴다. 이미 한도 안이면 같은 문자열을 돌려줘 불필요한 상태 갱신을 만들지 않는다. */
export function clampCodePoints(value: string, max: number): string {
  const points = Array.from(value);
  return points.length > max ? points.slice(0, max).join('') : value;
}
