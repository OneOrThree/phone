package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.repository.domain.GroupMember;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/** 멤버십 종료·재가입의 세대를 갱신하고 대표 섬과 현재 섬을 복구한다. */
@Service
@RequiredArgsConstructor
public class IslandMembershipTransitions {

    private final MainIslandService mainIslandService;
    private final UserIslandContextRecovery userIslandContextRecovery;

    /** 이탈 마킹과 같은 트랜잭션에서 대표 섬부터 복구한다. */
    @Transactional(propagation = Propagation.MANDATORY)
    public long recordMembershipRevoked(GroupMember member) {
        mainIslandService.onMembershipRevoked(member);
        userIslandContextRecovery.onMembershipRevoked(member);
        return member.advanceMembershipEpoch();
    }

    /**
     * 운영자가 섬을 닫을 때의 회수(GROMO-2763) — 일반 회수와 같되 메인 섬 이전 알림을 내지 않고, 남은 소속이 없으면
     * 먼바다(LEFT)를 확정한다. 운영 판단으로 사라진 섬 때문에 본인이 하지 않은 «이전» 알림이 가지 않게 한다.
     *
     * @param userId 그 멤버십의 사용자 — 호출자가 사용자 id 로 멤버십을 찾았다
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public long recordMembershipRevokedByOperator(GroupMember member, UUID userId) {
        mainIslandService.onMembershipRevoked(member, userId, false);
        userIslandContextRecovery.onMembershipRevoked(member);
        userIslandContextRecovery.releaseIfNoIslandLeft(userId);
        return member.advanceMembershipEpoch();
    }

    /** 재가입해도 과거 세대의 초대 코드는 다시 유효해지지 않는다. */
    @Transactional(propagation = Propagation.MANDATORY)
    public long recordMembershipRejoined(GroupMember member) {
        return member.advanceMembershipEpoch();
    }
}
