package com.oneorthree.phone.invitelink.dto;

import java.util.UUID;

/**
 * 초대 링크를 가리키는 값 — 랜딩 응답 경로가 엔티티 대신 이걸 들고 다닌다 (GROMO-1654).
 *
 * <p>종전엔 {@link LandingView} 가 {@code GroupInviteLink} 엔티티를 그대로 감싸 웹 계층까지
 * 넘겼다. 랜딩·클릭 적재·GA4 가 실제로 쓰는 값은 아래 셋뿐이라, 영속 객체를 컨트롤러까지
 * 끌고 갈 이유가 없다. 조회 시점에 이미 메모리에 있는 값을 옮겨 담을 뿐이라 추가 쿼리는 없다.
 *
 * @param id      초대 링크 PK — 클릭 적재({@code InviteLinkClick})의 FK 로 쓰인다
 * @param slug    링크 슬러그 — 랜딩 URL·커스텀 스킴·GA4 파라미터에 실린다
 * @param groupId 초대 대상 그룹 — 설치 유저가 서버 왕복 없이 초대 시트를 띄우도록 동봉한다
 */
public record InviteLinkRef(UUID id, String slug, UUID groupId) {
}
