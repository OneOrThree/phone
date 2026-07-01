import type { Friend, AllowedApp } from './types';

// 예시(stub) 데이터 — 친구·허용앱만. 과목/누적시간은 SubjectContext(실데이터)로 이동.
// 실제 연동(친구 실시간·허용앱 선택)은 후속 티켓.

// 09 친구 그리드 — 시안: 6명(활성 초록 글로우 / 휴식 / 오프)
export const EXAMPLE_FRIENDS: Friend[] = [
  { id: 'f1', name: '민지노트', color: '#C8893F', status: 'focus', elapsedSeconds: 3600 + 42 * 60 },
  { id: 'f2', name: '현생사는중', color: '#9A6FB0', status: 'focus', elapsedSeconds: 58 * 60 },
  { id: 'f3', name: '준비된자', color: '#5B8A6A', status: 'rest', elapsedSeconds: 0 },
  { id: 'f4', name: '태강', color: '#7A8AA0', status: 'focus', elapsedSeconds: 2 * 3600 + 10 * 60 },
  { id: 'f5', name: '도윤', color: '#6A9AA0', status: 'focus', elapsedSeconds: 3600 + 20 * 60 },
  { id: 'f6', name: '서연', color: '#B0607A', status: 'off', elapsedSeconds: 0 },
];

// 11 허용앱 — 시안: 전자사전/전자책/노트/계산기
export const EXAMPLE_ALLOWED_APPS: AllowedApp[] = [
  { id: 'a1', name: '전자사전', initial: '사', color: '#7FA06A' },
  { id: 'a2', name: '전자책', initial: '책', color: '#6E8FB0' },
  { id: 'a3', name: '노트', initial: '노', color: '#C8893F' },
  { id: 'a4', name: '계산기', initial: '수', color: '#9C7BB0' },
];
