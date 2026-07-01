import type { Subject, Friend, AllowedApp } from './types';

// ⚠️ 전부 예시(stub) 데이터 — 서버 tag/subject/허용앱 시스템과 무관. GROMO-553 UI 확인용.
// 실제 연동(과목 CRUD·친구 실시간·허용앱 선택)은 후속 티켓.

// 02 과목 리스트 — 시안: 노동법 12:30:00 / 행정쟁송법 8:10:00 / 사회보험법 0:50:22
export const EXAMPLE_SUBJECTS: Subject[] = [
  { id: 's1', name: '노동법', accumulatedSeconds: 12 * 3600 + 30 * 60 },
  { id: 's2', name: '행정쟁송법', accumulatedSeconds: 8 * 3600 + 10 * 60 },
  { id: 's3', name: '사회보험법', accumulatedSeconds: 50 * 60 + 22 },
];

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

// 10 메뉴 · 오늘 전체/과목별 집중 현황 — 시안 값(진행바 pct는 0~1)
export interface SubjectProgress {
  name: string;
  seconds: number;
  pct: number;
}
export const EXAMPLE_TODAY_TOTAL_SECONDS = 3 * 3600 + 12 * 60; // 03:12:00
export const EXAMPLE_SUBJECT_PROGRESS: SubjectProgress[] = [
  { name: '노동법', seconds: 3600 + 40 * 60, pct: 0.8 },
  { name: '행정쟁송법', seconds: 3600 + 2 * 60, pct: 0.5 },
  { name: '사회보험법', seconds: 30 * 60, pct: 0.25 },
];
