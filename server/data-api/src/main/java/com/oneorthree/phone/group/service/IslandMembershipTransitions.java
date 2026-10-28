package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.repository.domain.GroupMember;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

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

    /** 재가입해도 과거 세대의 초대 코드는 다시 유효해지지 않는다. */
    @Transactional(propagation = Propagation.MANDATORY)
    public long recordMembershipRejoined(GroupMember member) {
        return member.advanceMembershipEpoch();
    }
}
