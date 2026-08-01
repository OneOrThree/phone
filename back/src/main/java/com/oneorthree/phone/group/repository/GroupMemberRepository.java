package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface GroupMemberRepository extends JpaRepository<GroupMember, UUID> {

    @EntityGraph(attributePaths = "user")
    List<GroupMember> findByGroup(Group group);

    // getMyGroups 가 멤버마다 group.getName()/getMaxMembers()/getStatus()/isPrivate() 를 읽는다.
    // GroupMember.group 은 LAZY 라 fetch 하지 않으면 그룹 수 N 만큼 SELECT 가 더 나간다 — 멤버 수
    // 집계를 IN 1회로 줄여도 전체 쿼리는 여전히 N 에 비례했다. 그룹을 함께 로드해 2회로 고정한다.
    @EntityGraph(attributePaths = "group")
    List<GroupMember> findByUser(User user);

    Optional<GroupMember> findByUserAndGroup(User user, Group group);

    // 멀티 그룹 상한(MAX_JOINED_GROUPS) 검사용. 탈퇴는 행을 삭제하므로(withdrawGroup) 별도 제외 조건이
    // 없고, 이는 findByUser(=내 그룹 목록)와 같은 모수다 — 목록에 보이는 수와 상한이 어긋나지 않는다.
    long countByUser(User user);

    // 그룹별 멤버 수 일괄 집계 — 목록/검색이 그룹마다 findByGroup(group).size() 로 엔티티를 통째로
    // 로드하던 N+1 을 IN 집계 1회로 대체한다. 멤버가 0인 그룹은 행 자체가 없으므로 호출측이 0으로 채운다.
    @Query("SELECT gm.group.id AS groupId, COUNT(gm) AS memberCount FROM GroupMember gm"
            + " WHERE gm.group.id IN :groupIds GROUP BY gm.group.id")
    List<GroupMemberCount> countByGroupIdIn(@Param("groupIds") Collection<UUID> groupIds);

    /** {@link #countByGroupIdIn} 결과 행 — 그룹 id 와 그 그룹의 멤버 수. */
    interface GroupMemberCount {
        UUID getGroupId();

        long getMemberCount();
    }
}
