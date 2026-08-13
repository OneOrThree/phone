// 1:1 문의 담당자·카테고리 상수 — 단일 진실 원천.
// 담당자·링크 교체는 이 파일만 고치면 되고, JS 변경이라 hot-updater OTA로 심사 없이 배포된다
// (docs/prd/inquiry/policy.md D5). 여기에 import를 추가하지 말 것 — 순수 상수 모듈이다.
//
// ⚠️ 이 파일은 OTA로 자주 손대는 파일이고, 손대는 사람이 PRD를 다시 읽지 않는다.
//    계약은 inquiryContacts.test.ts가 잠근다 — 테스트가 깨지면 값을 고칠 게 아니라
//    docs/prd/inquiry/low-level-design.md §1을 먼저 읽을 것.

export type InquiryCategoryId = 'focus' | 'group' | 'etc';

export interface InquiryCategory {
  id: InquiryCategoryId;
  label: string;
}

export interface InquiryContact {
  /**
   * 분석 이벤트용 안정 슬러그 — 닉네임조차 아니다(PII 금지, policy.md D11).
   * `dev-{categoryId}`로 고정한다. 사람이 아니라 카테고리에 묶여야 담당자를 교체해도
   * GA4 계약(low-level-design.md §7)과 대시보드 필터가 안 깨지고 시계열이 안 끊긴다.
   */
  id: string;
  /** 닉네임(활동명). 실명이 아니다 — policy.md D10 */
  name: string;
  initial: string;
  /** T.avatarPalette 인덱스 — theme.ts를 import하지 않기 위해 숫자로 둔다 */
  avatarPaletteIndex: number;
  /** 성격 설명 — 어떤 쪽 문의에 어울리는지. 담당 영역(소유권)이 아니다(policy.md D6) */
  scopeLabel: string;
  /** 한 줄 소개 (사용자 말) — 어떤 증상일 때 이 사람인지 */
  intro: string;
  availability: string;
  /** 이 담당자가 추천되는 카테고리 — 카테고리당 정확히 1명 */
  categoryId: InquiryCategoryId;
  /** https 오픈채팅 URL. 커스텀 스킴 금지(policy.md D7) */
  openChatUrl: string;
}

export const INQUIRY_CATEGORIES: readonly InquiryCategory[] = [
  { id: 'focus', label: '집중 · 스크린타임' },
  { id: 'group', label: '그룹 · 챌린지' },
  { id: 'etc', label: '계정 · 기타' },
] as const;

// name 은 실명이 아니라 **닉네임(활동명)**이다(policy.md D10) — 실명을 넣지 말 것.
// openChatUrl 3개는 서로 달라야 한다 — 같은 방을 두 명이 가리키면 D2(직접 지목)와
// D3(담당자별 방 3개)가 동시에 깨지는데, 링크가 열리는지만 보는 QA로는 안 잡힌다.
//
// ⚠️ intro · availability 는 아직 자리표시자다(policy.md 미결 · low-level-design.md §9) —
//    담당자 본인에게 받아 채운다. availability 는 지킬 수 없는 시간을 적지 않는다(D9).
//    링크가 죽으면 앱은 감지하지 못한다 — 교체·점검 절차는 high-level-design.md §5.1.
export const INQUIRY_CONTACTS: readonly InquiryContact[] = [
  {
    id: 'dev-focus',
    name: 'JAJO',
    initial: 'J',
    avatarPaletteIndex: 0,
    scopeLabel: '집중 · 스크린타임 · 통계',
    intro: '타이머가 안 멈추거나 사용 시간이 이상하면 알려 주세요.',
    availability: '평일 10:00–19:00',
    categoryId: 'focus',
    openChatUrl: 'https://open.kakao.com/o/gu7GFKIi',
  },
  {
    id: 'dev-group',
    name: '오스카',
    initial: '오',
    avatarPaletteIndex: 1,
    scopeLabel: '그룹 · 챌린지 · 친구',
    intro: '그룹 초대가 안 되거나 챌린지 참여가 이상할 때 찾아 주세요.',
    availability: '평일 10:00–19:00',
    categoryId: 'group',
    openChatUrl: 'https://open.kakao.com/o/sll2EKIi',
  },
  {
    id: 'dev-etc',
    name: 'Aiden',
    initial: 'A',
    avatarPaletteIndex: 2,
    scopeLabel: '계정 · 결제 · 그 밖의 모든 것',
    intro: '어디에 물어야 할지 모르겠으면 저에게 주세요.',
    availability: '평일 10:00–19:00',
    categoryId: 'etc',
    openChatUrl: 'https://open.kakao.com/o/sYCkEKIi',
  },
] as const;
