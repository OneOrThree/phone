package com.oneorthree.phone.group.repository.domain;

/**
 * 그룹 수명주기 상태 — 실질적으로는 "종료됐는가" 한 축이다.
 *
 * <p>생성 시 {@link #WAITING} 으로 시작하고 {@code Group.close()} 가 {@link #ENDED} 로 한 번 넘기는 것이
 * 프로덕션의 전이 전부다({@link #ACTIVE} 로 올리는 경로는 현재 없다). 챌린지 진행 여부는 group_challenges 가
 * 소유하므로 그룹 상태가 그것을 따라가지 않는다.
 *
 * <p>그룹 <b>삭제</b>는 이 축이 아니라 {@code deleted_at}(소프트 딜리트)이다 — 조회는 두 축을 함께 봐야 한다.
 */
public enum GroupStatus {
    /** 생성 직후 기본값 — 살아 있는 그룹은 사실상 전부 이 값이다. */
    WAITING,
    /** 활동 중. 스키마·조회 호환용으로 남아 있고, 이 값을 쓰는 프로덕션 경로는 없다. */
    ACTIVE,
    /** 종료 — 초대 링크 참여가 막힌다({@code InviteLinkService} 가 이 상태를 걸러낸다). 되돌리는 경로는 없다. */
    ENDED
}
