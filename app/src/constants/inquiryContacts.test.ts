// inquiryContacts 상수 무결성 — docs/prd/inquiry/low-level-design.md §1의 불변식을 그대로 잠근다.
//
// 이 테스트의 목적은 **담당자를 교체하다 계약을 깨는 것을 막는 것**이다.
// 상수 파일은 담당자·링크가 바뀔 때마다 OTA로 손대는 파일이고(policy.md D5),
// 손대는 사람이 PRD를 다시 읽지 않는다. 여기서 깨지면 값을 고칠 게 아니라 §1을 먼저 읽을 것.
//
// ⚠️ 상수 모듈 본체(inquiryContacts.ts)는 import 없는 순수 모듈이다. 테스트만 theme을 읽어
//    avatarPaletteIndex 범위를 대조한다 — 그래야 상수 쪽에 색 의존성을 들이지 않고도 잠긴다.
import { T } from '@/constants/theme';
import { INQUIRY_CATEGORIES, INQUIRY_CONTACTS } from './inquiryContacts';

describe('INQUIRY_CONTACTS 불변식', () => {
  // 카테고리 수와 담당자 수가 어긋나면 「카테고리당 정확히 1명」(D6)이 성립할 수 없다.
  test('담당자 수가 카테고리 수와 같다', () => {
    expect(INQUIRY_CONTACTS.length).toBe(INQUIRY_CATEGORIES.length);
  });

  // 한 카테고리에 2명이면 추천 배지가 2장 붙고, 0명이면 그 칩을 고른 사용자에게 추천이 사라진다 — D6.
  test('카테고리마다 담당자가 정확히 1명이다', () => {
    const categoryIds = INQUIRY_CATEGORIES.map((c) => c.id);
    const assigned = INQUIRY_CONTACTS.map((c) => c.categoryId);

    expect([...assigned].sort()).toEqual([...categoryIds].sort());
  });

  // contact_id는 사람이 아니라 카테고리에 묶는다 — 담당자를 교체해도 GA4 계약(§7)과
  // 대시보드 필터가 안 깨지고 담당자별 시계열이 끊기지 않는다(D11).
  test('담당자 id가 dev-{categoryId} 형태로 고정돼 있다', () => {
    for (const contact of INQUIRY_CONTACTS) {
      expect(contact.id).toBe(`dev-${contact.categoryId}`);
    }
  });

  // id가 겹치면 GA4에서 두 담당자의 문의가 한 줄로 합쳐져 「쏠림」 신호(policy.md 뒤집을 때의 신호)를 못 본다.
  test('담당자 id가 유일하다', () => {
    const ids = INQUIRY_CONTACTS.map((c) => c.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  // startsWith 접두사 비교로는 https://example.com도 통과한다 — 오타 한 번이 사용자를
  // 카카오가 아닌 임의의 사이트로 보낸다. 호스트·경로 형식까지 파싱해서 잠근다(D7).
  test('오픈채팅 URL이 https://open.kakao.com/o/… 형식이다', () => {
    for (const contact of INQUIRY_CONTACTS) {
      const url = new URL(contact.openChatUrl);

      expect(url.protocol).toBe('https:');
      expect(url.host).toBe('open.kakao.com');
      expect(url.pathname).toMatch(/^\/o\/[A-Za-z0-9]+$/);
    }
  });

  // 형식 검사만으로는 담당자 둘에게 **같은 정상 URL**을 넣어도 전부 통과한다. 그러면 서로 다른
  // 담당자를 고른 사용자가 같은 방으로 들어가 D2(직접 지목)·D3(방 3개)가 동시에 깨지는데,
  // 링크가 열리는지만 보는 수동 QA(Q5)는 셋 다 열리므로 이걸 못 잡는다. 복붙 사고의 유일한 방어선이다.
  test('오픈채팅 URL이 서로 겹치지 않는다', () => {
    const urls = INQUIRY_CONTACTS.map((c) => c.openChatUrl);

    expect(new Set(urls).size).toBe(urls.length);
  });

  // 형식 검사(/^\/o\/[A-Za-z0-9]+$/)는 `…/o/TODOfocus` 같은 **자리표시자도 정상으로 통과시킨다**.
  // 실제 방 URL로 교체하다 한 명만 깜빡 잊는 것이 가장 흔한 사고인데, 형식만 보면 못 잡는다.
  // 이 테스트를 만든 이유가 「고치는 사람이 PRD를 다시 안 읽는다」는 것이었으므로 여기서 막는다.
  test('오픈채팅 URL에 자리표시자(TODO)가 남아 있지 않다', () => {
    for (const contact of INQUIRY_CONTACTS) {
      expect(contact.openChatUrl.toUpperCase()).not.toContain('TODO');
    }
  });

  // 상수 모듈이 theme을 import하지 않으므로(순수 모듈) 인덱스가 팔레트를 벗어나도 컴파일은 통과하고,
  // 화면에서 아바타 배경만 undefined가 된다 — 타입이 못 잡는 자리를 여기서 잡는다.
  test('avatarPaletteIndex가 T.avatarPalette 범위 안이다', () => {
    for (const contact of INQUIRY_CONTACTS) {
      expect(Number.isInteger(contact.avatarPaletteIndex)).toBe(true);
      expect(contact.avatarPaletteIndex).toBeGreaterThanOrEqual(0);
      expect(contact.avatarPaletteIndex).toBeLessThan(T.avatarPalette.length);
    }
  });
});
