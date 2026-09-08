package com.oneorthree.phone.common.port;

import java.util.Optional;

/**
 * slug → 초대 어트리뷰션 조회 포트 (GROMO-1656).
 *
 * <p><b>왜 포트인가.</b> 초대 링크는 그룹을 가리키므로 의존은 {@code invitelink → group} 이
 * 자연스럽다. 그런데 그룹 참여 로그가 slug 를 함께 남겨야 해서 {@code group → invitelink} 가
 * 생겼고, 두 방향이 겹쳐 순환이 됐다. 참여 경로가 필요한 것은 "이 slug 가 누구의, 어느 그룹
 * 링크인가" 한 가지뿐이라 그 질문만 포트로 세우고 답은 {@code invitelink} 가 낸다.
 *
 * <p>구현: {@code invitelink/service/InviteAttributionAdapter}.
 */
public interface InviteAttributionPort {

    /**
     * slug 로 어트리뷰션 정보를 찾는다.
     *
     * @param slug 공유 URL 에 실려 온 값. 변조될 수 있으므로 <b>호출측이</b> groupId·inviterId 를
     *             대조해야 한다 — 이 메서드는 존재 여부만 답한다
     * @return 그런 링크가 없으면 {@link Optional#empty()}
     */
    Optional<InviteAttribution> findBySlug(String slug);
}
