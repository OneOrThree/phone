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
  /**
   * 담당자를 나타내는 키워드 3개(가운뎃점으로 잇는다). 성격·분위기지 담당 영역이 아니다 —
   * 사용자는 이걸 무시하고 아무나 고를 수 있다(policy.md D2 · D6).
   * ⚠️ 사람에 대한 서술이므로 **본인이 고른 표현만** 넣는다.
   */
  keywords: string;
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
// keywords 는 담당자 본인이 고른 표현이다 — 남이 대신 정해 넣지 않는다.
// 응답 가능 시간은 카드에 적지 않는다(D9 개정 2026-08-14) — 셋 다 같은 값이라 정보량이 0이었고,
// 기대치 관리는 화면 하단 안내 박스가 진다.
// 링크가 죽으면 앱은 감지하지 못한다 — 교체·점검 절차는 high-level-design.md §5.1.
export const INQUIRY_CONTACTS: readonly InquiryContact[] = [
  {
    id: 'dev-focus',
    name: 'JAJO',
    initial: 'J',
    avatarPaletteIndex: 0,
    keywords: '빠름 · 조금 빠름 · 많이 빠름',
    categoryId: 'focus',
    openChatUrl: 'https://open.kakao.com/o/gu7GFKIi',
  },
  {
    id: 'dev-group',
    name: '오스카',
    initial: '오',
    avatarPaletteIndex: 1,
    keywords: '초미녀 · 친절 · 상시 대기',
    categoryId: 'group',
    openChatUrl: 'https://open.kakao.com/o/sll2EKIi',
  },
  {
    id: 'dev-etc',
    name: 'Aiden',
    initial: 'A',
    avatarPaletteIndex: 2,
    keywords: '친절 · 미소 · 환영',
    categoryId: 'etc',
    openChatUrl: 'https://open.kakao.com/o/sYCkEKIi',
  },
] as const;
