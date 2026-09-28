import { Linking } from 'react-native';

// 정책 원문은 team-page 레포의 Catus 정책 포털이 정본이다 (src/content/catus-*.md).
const POLICY_BASE_URL = 'https://team-page-one-or-three.vercel.app/catus';

export const TERMS_URL = `${POLICY_BASE_URL}/terms/`;
export const PRIVACY_URL = `${POLICY_BASE_URL}/privacy/`;

/** 정책 문서를 외부 브라우저로 연다. 열 수 없는 환경이면 조용히 무시한다. */
export function openPolicy(url: string) {
  Linking.openURL(url).catch(() => {});
}
