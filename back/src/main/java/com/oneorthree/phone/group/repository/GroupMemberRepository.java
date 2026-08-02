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

    // A-0 소프트삭제: 아래 조회는 전부 활성 멤버(is_left=false)만 본다. 탈퇴/강퇴 행은 보존되므로
    // 필터가 없으면 정원·목록·마지막 1인 판정이 떠난 멤버를 포함해 깨진다. 재가입 판정만 예외로
    // findAnyByUserAndGroup(전체 포함)을 쓴다.
    @EntityGraph(attributePaths = "user")
    @Query("SELECT gm FROM GroupMember gm WHERE gm.group = :group AND gm.isLeft = false")
    List<GroupMember> findByGroup(@Param("group") Group group);

    // getMyGroups 가 멤버마다 group.getName()/getMaxMembers()/getStatus()/isPrivate() 를 읽는다.
    // GroupMember.group 은 LAZY 라 fetch 하지 않으면 그룹 수 N 만큼 SELECT 가 더 나간다 — 멤버 수
    // 집계를 IN 1회로 줄여도 전체 쿼리는 여전히 N 에 비례했다. 그룹을 함께 로드해 2회로 고정한다.
    @EntityGraph(attributePaths = "group")
    @Query("SELECT gm FROM GroupMember gm WHERE gm.user = :user AND gm.isLeft = false")
    List<GroupMember> findByUser(@Param("user") User user);

    // 활성 멤버십만 — 강퇴/탈퇴(is_left)는 없는 것으로 본다(멤버십 검증·권한 판정 공용).
    @Query("SELECT gm FROM GroupMember gm WHERE gm.user = :user AND gm.group = :group AND gm.isLeft = false")
    Optional<GroupMember> findByUserAndGroup(@Param("user") User user, @Param("group") Group group);

    // 초대 링크 발급(invitelink 도메인)의 멤버십 검증용 — 활성 멤버(is_left=false)만 멤버로 본다.
    // A-0 소프트삭제 이후 탈퇴/강퇴는 행을 지우지 않고 is_left=true 로 마킹만 하므로, 필터 없이
    // 존재만 물으면 나간/강퇴된 유저가 여전히 '멤버'로 잡혀 초대 링크를 계속 발급할 수 있다 —
    // 다른 활성 조회(findByUserAndGroup 등)와 같은 기준(is_left=false)으로 맞춘다.
    @Query("SELECT COUNT(gm) > 0 FROM GroupMember gm "
            + "WHERE gm.group.id = :groupId AND gm.user.id = :userId AND gm.isLeft = false")
    boolean existsByGroupIdAndUserId(@Param("groupId") UUID groupId, @Param("userId") UUID userId);

    // 재가입 로직 전용 — 소프트삭제 행 포함 전체. 유니크(user,group) 제약상 재삽입 불가라, 자진 탈퇴자
    // 재가입은 이 행을 되살리고(rejoin), 강퇴자는 거절한다.
    @Query("SELECT gm FROM GroupMember gm WHERE gm.user = :user AND gm.group = :group")
    Optional<GroupMember> findAnyByUserAndGroup(@Param("user") User user, @Param("group") Group group);

    // A-2: 계정 탈퇴 시 방장으로 남은 그룹 정리용 — 유저가 현재 방장(활성)인 멤버십과 그 그룹.
    // 혼자인 그룹은 자동 종료하고, 다른 멤버가 있으면 위임이 필요해 탈퇴가 막힌다(HOST_WITHDRAW).
    @EntityGraph(attributePaths = "group")
    @Query("SELECT gm FROM GroupMember gm WHERE gm.user.id = :userId "
            + "AND gm.role = com.oneorthree.phone.group.domain.GroupMemberRole.OWNER AND gm.isLeft = false")
    List<GroupMember> findActiveOwnerMembershipsByUserId(@Param("userId") UUID userId);

    // 멀티 그룹 상한(MAX_JOINED_GROUPS) 검사용 — findByUser(내 그룹 목록)와 같은 모수(활성만).
    @Query("SELECT COUNT(gm) FROM GroupMember gm WHERE gm.user = :user AND gm.isLeft = false")
    long countByUser(@Param("user") User user);

    // 그룹별 멤버 수 일괄 집계 — 목록/검색이 그룹마다 findByGroup(group).size() 로 엔티티를 통째로
    // 로드하던 N+1 을 IN 집계 1회로 대체한다. 멤버가 0인 그룹은 행 자체가 없으므로 호출측이 0으로 채운다.
    @Query("SELECT gm.group.id AS groupId, COUNT(gm) AS memberCount FROM GroupMember gm"
            + " WHERE gm.group.id IN :groupIds AND gm.isLeft = false GROUP BY gm.group.id")
    List<GroupMemberCount> countByGroupIdIn(@Param("groupIds") Collection<UUID> groupIds);

    /** {@link #countByGroupIdIn} 결과 행 — 그룹 id 와 그 그룹의 멤버 수. */
    interface GroupMemberCount {
        UUID getGroupId();

        long getMemberCount();
    }
}
