package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.UUID;

/** users 잠금 뒤 모든 멤버십 writer가 공유하는 그룹 직렬화 경계. 외부 I/O를 실행하지 않는다. */
@Service
@RequiredArgsConstructor
@Transactional(propagation = Propagation.MANDATORY)
public class GroupMembershipMutationLocks {
    private final GroupRepository groups;
    private final GroupMemberRepository members;

    /** 해당 그룹의 권한/정원 판정 전에 잠근다. 종료 여부는 호출 계약에 따라 별도 검사한다. */
    public void lockGroup(UUID groupId) {
        groups.findByIdForUpdate(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.GROUP_NOT_FOUND));
    }

    /** 계정 탈퇴는 돈이 움직이기 전에 관련 그룹 전부를 같은 순서로 잠근다. */
    public void lockGroups(Collection<UUID> groupIds) {
        groupIds.stream().distinct().sorted().forEach(this::lockGroup);
    }

    /** 그룹을 먼저 잠근 뒤 실제로 바꿀 회원만 잠근다. 다른 주민의 행까지 선점하지 않는다. */
    public void lockMembers(UUID groupId, Collection<UUID> userIds) {
        userIds.stream().distinct().sorted().forEach(userId -> members.lockActiveMembershipId(groupId, userId));
    }
}
