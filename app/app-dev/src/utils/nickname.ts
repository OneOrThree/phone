/** 서버의 Unicode White_Space+BOM과 같은 범위. JS 공백에 빠진 NEL도 제거한다. */
export const stripNicknameWhitespace = (value: string): string => value.replace(/[\s\u0085]/g, '');
