// 초대 링크 공유 본문 — 그룹방 초대 타일(GroupRoomScreen)과 생성 직후 다이얼로그
// (GroupCreateScreen)가 같은 문구를 쓴다. 같은 행동인데 진입점마다 말이 달라지지 않게
// 한 곳에 묶어 뒀다.
//
// 카톡 말풍선은 이 본문 아래에 서버가 만든 OG 카드가 한 겹 더 붙는다. 그래서 본문은
// '누가 어디로 부르는지' 한 줄만 맡는다. 그룹명에 따옴표·꺾쇠를 씌우지 않는 것도 같은 이유 —
// OG 카드 제목이 이미 「그룹명」을 쓰므로 본문까지 감싸면 괄호가 두 겹이 된다.
//
// url 은 **반드시 서버 발급 invite.url**을 넣는다. 앱이 조립한 주소는 slug 가 없어
// 어트리뷰션 원장에 이어지지 않는다(초대 링크 스펙 §4-2 ①·§7-4).
export function buildInviteShareMessage(groupName: string, url: string): string {
  return `${flattenGroupName(groupName)} 그룹에 초대했어요! 같이 집중해요 ⭐️\n${url}`;
}

// 그룹명의 줄바꿈·탭을 한 칸 공백으로 눕힌다. 본문이 "이름 + 개행 + url" 구조라, 이름 안에
// 개행이 있으면 그 뒤 문자열이 링크 줄처럼 보인다 — 이름에 가짜 주소를 심어 두면 받는 쪽은
// 진짜 초대 링크와 구분하기 어렵다. 개명 API 는 길이·문자 제약이 없어(@Valid 미배선)
// 서버가 걸러 주지 못하므로 공유 지점에서 1차로 막는다. 근본 수정은 백엔드 몫이다.
function flattenGroupName(groupName: string): string {
  return groupName.replace(/\s+/g, ' ').trim();
}
