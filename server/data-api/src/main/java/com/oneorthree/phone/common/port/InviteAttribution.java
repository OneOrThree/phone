package com.oneorthree.phone.common.port;

import java.util.UUID;

/**
 * 초대 링크 어트리뷰션에 필요한 최소 정보 (GROMO-1656).
 *
 * <p>{@code invitelink} 엔티티를 그대로 넘기지 않는 이유가 이 레코드의 존재 이유다 — 엔티티를
 * 노출하면 그것을 받는 도메인이 초대 링크의 <b>전체 수명주기</b>(생성·만료·클릭 적재)에
 * 컴파일로 묶인다. 어트리뷰션에 실제로 쓰이는 값은 아래 셋뿐이다.
 *
 * @param slug      공유 URL 에 실린 초대 slug
 * @param groupId   이 링크가 가리키는 그룹 — 호출측이 실제 참여 그룹과 대조해 변조를 흡수한다
 * @param inviterId 링크를 만든 유저 — 호출측이 참여자와 대조해 셀프 초대를 걸러낸다
 */
public record InviteAttribution(String slug, UUID groupId, UUID inviterId) {
}
