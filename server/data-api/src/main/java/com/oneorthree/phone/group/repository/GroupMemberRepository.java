package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.user.repository.domain.User;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface GroupMemberRepository extends JpaRepository<GroupMember, UUID> {

    /**
     * A-0 소프트삭제: 아래 조회는 전부 활성 멤버(is_left=false)만 본다. 탈퇴/강퇴 행은 보존되므로
     * 필터가 없으면 정원·목록·마지막 1인 판정이 떠난 멤버를 포함해 깨진다. 재가입 판정만 예외로
     * findAnyByUserAndGroup(전체 포함)을 쓴다.
     */
    @EntityGraph(attributePaths = "user")
    @Query("SELECT gm FROM GroupMember gm WHERE gm.group = :group AND gm.isLeft = false")
    List<GroupMember> findByGroup(@Param("group") Group group);

    /**
     * 챌린지 종료 푸시(B4·GROMO-1088) — 종료된 챌린지들의 그룹원을 한 번에 로드한다. 종료가 몰리는
     * 틱(같은 시각에 창이 끝나는 그룹들)과 일 마감 배치(활성 일 목표 챌린지 전건)에서 그룹마다
     * findByGroup 을 부르면 그룹 수만큼 쿼리가 나간다. 필터 기준(is_left=false)은 findByGroup 과 같다.
     * group 까지 fetch 하는 이유: 호출측이 멤버를 그룹별로 접어야 해서 gm.group.id 를 읽는데,
     * LAZY 프록시 초기화에 기대면 그룹 수만큼 SELECT 가 다시 나갈 수 있다.
     */
    @EntityGraph(attributePaths = {"user", "group"})
    @Query("SELECT gm FROM GroupMember gm WHERE gm.group.id IN :groupIds AND gm.isLeft = false")
    List<GroupMember> findByGroupIdIn(@Param("groupIds") Collection<UUID> groupIds);

    /**
     * getMyGroups 가 멤버마다 group.getName()/getMaxMembers()/getStatus()/isPrivate() 를 읽는다.
     * GroupMember.group 은 LAZY 라 fetch 하지 않으면 그룹 수 N 만큼 SELECT 가 더 나간다 — 멤버 수
     * 집계를 IN 1회로 줄여도 전체 쿼리는 여전히 N 에 비례했다. 그룹을 함께 로드해 2회로 고정한다.
     */
    @EntityGraph(attributePaths = "group")
    @Query("SELECT gm FROM GroupMember gm WHERE gm.user = :user AND gm.isLeft = false")
    List<GroupMember> findByUser(@Param("user") User user);

    /**
     * 활성 멤버십만 — 강퇴/탈퇴(is_left)는 없는 것으로 본다(멤버십 검증·권한 판정 공용).
     */
    @Query("SELECT gm FROM GroupMember gm WHERE gm.user = :user AND gm.group = :group AND gm.isLeft = false")
    Optional<GroupMember> findByUserAndGroup(@Param("user") User user, @Param("group") Group group);

    /**
     * 초대 링크 발급(invitelink 도메인)의 멤버십 검증용 — 활성 멤버(is_left=false)만 멤버로 본다.
     * A-0 소프트삭제 이후 탈퇴/강퇴는 행을 지우지 않고 is_left=true 로 마킹만 하므로, 필터 없이
     * 존재만 물으면 나간/강퇴된 유저가 여전히 '멤버'로 잡혀 초대 링크를 계속 발급할 수 있다 —
     * 다른 활성 조회(findByUserAndGroup 등)와 같은 기준(is_left=false)으로 맞춘다.
     */
    @Query("SELECT COUNT(gm) > 0 FROM GroupMember gm "
            + "WHERE gm.group.id = :groupId AND gm.user.id = :userId AND gm.isLeft = false")
    boolean existsByGroupIdAndUserId(@Param("groupId") UUID groupId, @Param("userId") UUID userId);

    /**
     * 내기 참여 경로 전용(GROMO-1262, N54 차감 직전 활성 멤버십 재검증) — 활성 멤버십 행을 공유
     * 잠금으로 읽는다. 그룹 탈퇴(withdrawGroup → releaseFromOpenSessions)가 같은 행을 배타 잠금으로
     * 먼저 잡으므로, 참여와 탈퇴가 멤버십 행에서 직렬화된다: 참여가 먼저면 탈퇴의 회차 정리가 방금
     * 커밋된 참가까지 보고 환불하고, 탈퇴가 먼저면 참여의 이 조회가 빈 결과(is_left=true)로 403 이다.
     * users 행 공유 락만으로는 그룹 탈퇴와 직렬화되지 않는다(탈퇴는 group_members 를 바꾼다) —
     * 1258 P0 "탈퇴 우회 유료 예약"의 재발 방지 축. 잠금 순서: user → 멤버십 → 회차 → 지갑.
     */
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("SELECT gm FROM GroupMember gm WHERE gm.user.id = :userId AND gm.group.id = :groupId "
            + "AND gm.isLeft = false")
    Optional<GroupMember> findActiveByUserIdAndGroupIdForShare(
            @Param("userId") UUID userId,
            @Param("groupId") UUID groupId);

    /**
     * 내기 탈퇴 연동 전용(GROMO-1262) — 탈퇴 쪽에서 멤버십 행을 배타 잠금으로 선점해 위 공유 잠금과
     * 짝을 이룬다. withdrawGroup 은 회차 정리 후에야 is_left 를 마킹하므로, 이 선점이 없으면 정리
     * 스캔과 leave() 사이에 새 참가가 끼어들 수 있다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT gm FROM GroupMember gm WHERE gm.user.id = :userId AND gm.group.id = :groupId "
            + "AND gm.isLeft = false")
    Optional<GroupMember> findActiveByUserIdAndGroupIdForUpdate(
            @Param("userId") UUID userId,
            @Param("groupId") UUID groupId);

    /**
     * 재가입 로직 전용 — 소프트삭제 행 포함 전체. 유니크(user,group) 제약상 재삽입 불가라, 자진 탈퇴자
     * 재가입은 이 행을 되살리고(rejoin), 강퇴자는 거절한다.
     */
    @Query("SELECT gm FROM GroupMember gm WHERE gm.user = :user AND gm.group = :group")
    Optional<GroupMember> findAnyByUserAndGroup(@Param("user") User user, @Param("group") Group group);

    /**
     * A-2: 계정 탈퇴 시 방장으로 남은 그룹 정리용 — 유저가 현재 방장(활성)인 멤버십과 그 그룹.
     * 혼자인 그룹은 자동 종료하고, 다른 멤버가 있으면 위임이 필요해 탈퇴가 막힌다(HOST_WITHDRAW).
     */
    @EntityGraph(attributePaths = "group")
    @Query("SELECT gm FROM GroupMember gm WHERE gm.user.id = :userId "
            + "AND gm.role = com.oneorthree.phone.group.repository.domain.GroupMemberRole.OWNER AND gm.isLeft = false")
    List<GroupMember> findActiveOwnerMembershipsByUserId(@Param("userId") UUID userId);

    /**
     * 멀티 그룹 상한(MAX_JOINED_GROUPS) 검사용 — findByUser(내 그룹 목록)와 같은 모수(활성만).
     */
    @Query("SELECT COUNT(gm) FROM GroupMember gm WHERE gm.user = :user AND gm.isLeft = false")
    long countByUser(@Param("user") User user);

    /**
     * 그룹별 멤버 수 일괄 집계 — 목록/검색이 그룹마다 findByGroup(group).size() 로 엔티티를 통째로
     * 로드하던 N+1 을 IN 집계 1회로 대체한다. 멤버가 0인 그룹은 행 자체가 없으므로 호출측이 0으로 채운다.
     * 탈퇴 유저(is_deleted)도 세지 않는다(GROMO-1220) — 상세 멤버 목록·정원 판정(GroupService.
     * activeMembersOf)과 같은 기준이어야 "목록 N명 · 카운트 N+1명" 불일치가 안 생긴다. 집계라
     * 서비스 스트림 필터를 태울 수 없어 이 쿼리만 예외적으로 유저 조인 필터를 건다(소비처는
     * getMyGroups·searchGroups 뿐 — 정산·환불 경로와 무관).
     */
    @Query("SELECT gm.group.id AS groupId, COUNT(gm) AS memberCount FROM GroupMember gm"
            + " WHERE gm.group.id IN :groupIds AND gm.isLeft = false AND gm.user.isDeleted = false"
            + " GROUP BY gm.group.id")
    List<GroupMemberCount> countByGroupIdIn(@Param("groupIds") Collection<UUID> groupIds);

    /** {@link #countByGroupIdIn} 결과 행 — 그룹 id 와 그 그룹의 멤버 수. */
    interface GroupMemberCount {
        UUID getGroupId();

        long getMemberCount();
    }
}
