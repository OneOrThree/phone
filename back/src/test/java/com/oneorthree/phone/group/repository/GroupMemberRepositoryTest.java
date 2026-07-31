package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

// 목록/검색의 N+1 을 대체하는 IN 집계(countByGroupIdIn)가 실 DB 에서 작동하는지 검증한다.
// 서비스 단위 테스트는 이 쿼리를 모킹하므로, JPQL·프로젝션 매핑 오류는 여기서만 잡힌다.
class GroupMemberRepositoryTest extends RepositoryTestBase {

    @Autowired
    GroupMemberRepository groupMemberRepository;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    UserRepository userRepository;

    @Test
    @DisplayName("countByGroupIdIn → 그룹별 멤버 수를 한 번에 집계하고, 멤버 없는 그룹은 행이 없다")
    void countByGroupIdInAggregatesPerGroup() {
        // given: 멤버 2명인 그룹, 1명인 그룹, 0명인 그룹
        Group groupWithTwo = groupRepository.save(Group.builder().name("둘").maxMembers(10).build());
        Group groupWithOne = groupRepository.save(Group.builder().name("하나").maxMembers(10).build());
        Group emptyGroup = groupRepository.save(Group.builder().name("빈방").maxMembers(10).build());

        User userA = userRepository.save(User.builder().nickname("A").build());
        User userB = userRepository.save(User.builder().nickname("B").build());

        groupMemberRepository.save(GroupMember.builder().user(userA).group(groupWithTwo).build());
        groupMemberRepository.save(GroupMember.builder().user(userB).group(groupWithTwo).build());
        groupMemberRepository.save(GroupMember.builder().user(userA).group(groupWithOne).build());
        groupMemberRepository.flush();

        // when
        Map<UUID, Long> counts = groupMemberRepository
                .countByGroupIdIn(List.of(groupWithTwo.getId(), groupWithOne.getId(), emptyGroup.getId()))
                .stream()
                .collect(Collectors.toMap(
                        GroupMemberRepository.GroupMemberCount::getGroupId,
                        GroupMemberRepository.GroupMemberCount::getMemberCount));

        // then
        assertThat(counts).containsOnly(
                Map.entry(groupWithTwo.getId(), 2L),
                Map.entry(groupWithOne.getId(), 1L));
        assertThat(counts).doesNotContainKey(emptyGroup.getId());
    }
}
