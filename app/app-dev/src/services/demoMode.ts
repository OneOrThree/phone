import { Platform } from 'react-native';

// 목업(서버 없음) 모드 판정의 단일 정본.
// 웹은 주소의 ?review / ?demo 로, 네이티브 QA 빌드는 EXPO_PUBLIC_DEMO=1 (Metro·번들 시 인라인) 로 켠다.
// 모듈 상수가 아니라 호출 때 읽는 함수다 — 테스트가 Platform.OS·location 을 바꿔 끼우기 때문.
const hasWebParam = (name: string) =>
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has(name);

export const isReviewMode = () => hasWebParam('review');
export const isDemoMode = () => hasWebParam('demo') || process.env.EXPO_PUBLIC_DEMO === '1';
/** review 또는 demo — 서버를 부르지 않고 로컬 목업 데이터로 그리는 경로 */
export const isMockMode = () => isReviewMode() || isDemoMode();
