package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import jakarta.persistence.EntityManager;
import org.hibernate.Hibernate;
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
    @Autowired
    EntityManager em;

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

    @Test
    @DisplayName("findByUser → group 을 함께 로드한다 (LAZY 프록시로 두면 그룹 수만큼 SELECT 가 더 나간다)")
    void findByUserFetchesGroup() {
        // given: 한 유저가 여러 그룹에 가입
        User user = userRepository.save(User.builder().nickname("나").build());
        groupMemberRepository.save(GroupMember.builder().user(user)
                .group(groupRepository.save(Group.builder().name("A").maxMembers(10).build())).build());
        groupMemberRepository.save(GroupMember.builder().user(user)
                .group(groupRepository.save(Group.builder().name("B").maxMembers(10).build())).build());
        groupMemberRepository.flush();

        // 영속성 컨텍스트를 비워야 한다 — 안 비우면 위에서 save 한 Group 이 1차 캐시에 남아
        // fetch 여부와 무관하게 초기화된 상태로 보여 이 검증이 항상 통과한다.
        em.clear();

        // when
        List<GroupMember> members = groupMemberRepository.findByUser(user);

        // then: @EntityGraph 가 빠지면 group 은 미초기화 프록시고, getMyGroups 가 필드를 읽는 순간
        //   그룹마다 SELECT 가 나간다(N+1). 값이 맞는지가 아니라 '이미 로드됐는지'를 잠근다.
        assertThat(members).hasSize(2);
        assertThat(members).allSatisfy(member ->
                assertThat(Hibernate.isInitialized(member.getGroup())).isTrue());
        assertThat(members).extracting(member -> member.getGroup().getName())
                .containsExactlyInAnyOrder("A", "B");
    }

    @Test
    @DisplayName("countByUser → findByUser 와 같은 모수(내 소속 그룹 수). 다른 유저의 소속은 세지 않는다")
    void countByUserCountsOnlyOwnMemberships() {
        // given: 나는 2개 그룹, 남은 1개 그룹에 소속
        User me = userRepository.save(User.builder().nickname("나").build());
        User other = userRepository.save(User.builder().nickname("남").build());
        Group groupA = groupRepository.save(Group.builder().name("A").maxMembers(10).build());
        Group groupB = groupRepository.save(Group.builder().name("B").maxMembers(10).build());
        Group groupC = groupRepository.save(Group.builder().name("C").maxMembers(10).build());

        groupMemberRepository.save(GroupMember.builder().user(me).group(groupA).build());
        groupMemberRepository.save(GroupMember.builder().user(me).group(groupB).build());
        groupMemberRepository.save(GroupMember.builder().user(other).group(groupC).build());
        groupMemberRepository.flush();

        // then: 상한 검사(countByUser)와 목록(findByUser)이 어긋나면 "목록엔 9개인데 가입 불가"가 된다
        assertThat(groupMemberRepository.countByUser(me)).isEqualTo(2L);
        assertThat(groupMemberRepository.countByUser(me))
                .isEqualTo(groupMemberRepository.findByUser(me).size());
        assertThat(groupMemberRepository.countByUser(other)).isEqualTo(1L);
    }

    @Test
    @DisplayName("existsByGroupIdAndUserId → 활성 멤버만 true, 탈퇴/강퇴(is_left)는 비멤버로 본다")
    void existsByGroupIdAndUserIdExcludesLeftMembers() {
        // given: 같은 그룹의 활성 1명 · 자진 탈퇴 1명 · 강퇴 1명, 그리고 가입한 적 없는 외부인
        Group group = groupRepository.save(Group.builder().name("방").maxMembers(10).build());
        User active = userRepository.save(User.builder().nickname("활성").build());
        User left = userRepository.save(User.builder().nickname("탈퇴").build());
        User kicked = userRepository.save(User.builder().nickname("강퇴").build());
        User outsider = userRepository.save(User.builder().nickname("외부인").build());

        groupMemberRepository.save(GroupMember.builder().user(active).group(group).build());
        GroupMember leftMember = GroupMember.builder().user(left).group(group).build();
        leftMember.leave();
        groupMemberRepository.save(leftMember);
        GroupMember kickedMember = GroupMember.builder().user(kicked).group(group).build();
        kickedMember.kick();
        groupMemberRepository.save(kickedMember);
        groupMemberRepository.flush();

        // then: A-0 소프트삭제로 행은 남지만, 초대 링크 발급 검증(InviteLinkService)은 활성만 통과해야 한다 —
        //   필터가 빠지면 나간/강퇴된 유저가 계속 그 그룹의 초대 링크를 발급할 수 있다(회귀).
        assertThat(groupMemberRepository.existsByGroupIdAndUserId(group.getId(), active.getId())).isTrue();
        assertThat(groupMemberRepository.existsByGroupIdAndUserId(group.getId(), left.getId())).isFalse();
        assertThat(groupMemberRepository.existsByGroupIdAndUserId(group.getId(), kicked.getId())).isFalse();
        assertThat(groupMemberRepository.existsByGroupIdAndUserId(group.getId(), outsider.getId())).isFalse();
    }
}
