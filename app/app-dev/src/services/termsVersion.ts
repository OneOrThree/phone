/** 빌드별 실제 약관 문서 버전. 미설정·공백은 로그인 차단을 뜻한다. */
export function resolveTermsVersion(value: string | undefined): string {
  return value?.trim() ?? '';
}

export const TERMS_VERSION = resolveTermsVersion(process.env.EXPO_PUBLIC_TERMS_VERSION);
