// "지금 그룹 흐름 안인가" 순수 판정(GROMO-1576).
//
// 루트의 결과 모달 호스트는 화면별 useIsFocused를 못 쓰고 **라우트 이름 하나**로 판정한다.
// 그래서 이 목록이 조용히 낡는 것(라우트 추가·개명)이 이 배선의 유일한 실패 모드다 —
// 판정을 순수 함수로 떼어 여기서 고정한다.
import { GROUP_TAB_ROUTE, isGroupFlowRoute } from './groupFlowRoute';

describe('isGroupFlowRoute', () => {
  test('그룹 탭과 그룹 스택 화면은 그룹 흐름이다', () => {
    expect(isGroupFlowRoute(GROUP_TAB_ROUTE)).toBe(true);
    // 그룹방 — 이 배치의 존재 이유(예전 소유자는 이 라우트 위로 뜰 수 없었다).
    expect(isGroupFlowRoute('GroupRoom')).toBe(true);
    expect(isGroupFlowRoute('GroupChallengeHistory')).toBe(true);
    expect(isGroupFlowRoute('GroupSettings')).toBe(true);
    expect(isGroupFlowRoute('GroupCreate')).toBe(true);
    expect(isGroupFlowRoute('GroupNotice')).toBe(true);
    expect(isGroupFlowRoute('GroupCardEmojiEdit')).toBe(true);
    expect(isGroupFlowRoute('GroupProfileEdit')).toBe(true);
    expect(isGroupFlowRoute('GroupMemberManage')).toBe(true);
    expect(isGroupFlowRoute('GroupOwnerTransfer')).toBe(true);
    expect(isGroupFlowRoute('GroupNoticePermission')).toBe(true);
  });

  test('다른 탭·집중 플로우는 그룹 흐름이 아니다', () => {
    ['홈', '리그', '전체', 'FocusSession', 'FocusResult', 'LeagueResult', 'Main'].forEach(
      (name) => {
        expect(isGroupFlowRoute(name)).toBe(false);
      },
    );
  });

  test('라우트를 읽지 못하면 "그룹 흐름 아님"으로 강하한다', () => {
    // 컨테이너 준비 전·구버전 ref — 홈이나 집중 세션 위로 정산 결과 모달이 튀어나오는 쪽이
    // 한 박자 늦게 뜨는 쪽보다 훨씬 나쁘다(결과는 다음 판정에서 다시 뜬다).
    expect(isGroupFlowRoute(undefined)).toBe(false);
    expect(isGroupFlowRoute(null)).toBe(false);
    expect(isGroupFlowRoute('')).toBe(false);
  });

  test('이름이 비슷하다고 통과시키지 않는다 — 정확히 일치할 때만이다', () => {
    expect(isGroupFlowRoute('GroupRoomRoute')).toBe(false);
    expect(isGroupFlowRoute('그룹찾기')).toBe(false);
  });
});
