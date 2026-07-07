import type { AllowedApp } from './types';

// 예시(stub) 데이터 — 허용앱만. 과목/누적시간은 SubjectContext, 친구 그리드는
// 핀 친구 실데이터(@/v2/screens/league/usePinnedFriends)로 이동.

// 11 허용앱 — 시안: 전자사전/전자책/노트/계산기
export const EXAMPLE_ALLOWED_APPS: AllowedApp[] = [
  { id: 'a1', name: '전자사전', initial: '사', color: '#7FA06A' },
  { id: 'a2', name: '전자책', initial: '책', color: '#6E8FB0' },
  { id: 'a3', name: '노트', initial: '노', color: '#5E6AD2' },
  { id: 'a4', name: '계산기', initial: '수', color: '#9C7BB0' },
];
