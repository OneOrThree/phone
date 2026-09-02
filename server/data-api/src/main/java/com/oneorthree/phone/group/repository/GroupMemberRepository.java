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

/**
 * 그룹 멤버십 조회. <b>기본 모수는 활성 멤버({@code is_left = false})</b>다 — 탈퇴·강퇴가 행을 지우지 않는
 * 소프트삭제(A-0)라, 필터가 빠진 조회 하나면 떠난 사람이 정원·목록·권한 판정에 되살아난다.
 * 유일한 예외가 {@link #findAnyByUserAndGroup} 이고, 그건 "재가입해도 되는 사람인가"를 판단하려면
 * 떠난 행을 봐야 하기 때문이다.
 *
 * <p>멤버십 행은 내기 참여와 그룹 탈퇴가 부딪히는 <b>직렬화 지점</b>이기도 하다 — 참여는 공유 락,
 * 탈퇴는 배타 락으로 같은 행을 잡는다(1258 P0 "탈퇴 우회 유료 예약" 재발 방지축).
 */
public interface GroupMemberRepository extends JpaRepository<GroupMember, UUID> {

    /**
     * A-0 소프트삭제: 아래 조회는 전부 활성 멤버(is_left=false)만 본다. 탈퇴/강퇴 행은 보존되므로
     * 필터가 없으면 정원·목록·마지막 1인 판정이 떠난 멤버를 포함해 깨진다. 재가입 판정만 예외로
     * findAnyByUserAndGroup(전체 포함)을 쓴다.
     *
     * @param group 멤버를 뽑을 그룹
     * @return 활성 멤버 전량(유저가 함께 로드된 상태). 정렬·페이징이 없고 정원 상한만큼만 나온다.
     *     <b>탈퇴한 유저({@code users.is_deleted})는 걸러지지 않으므로</b> 화면 목록은 서비스에서 한 번
     *     더 접는다. 빈 리스트는 사실상 방이 비었다는 뜻이다
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
     *
     * @param groupIds 그룹원을 모을 그룹 id 들. 빈 컬렉션이면 빈 결과다
     * @return 여러 그룹의 활성 멤버가 <b>한 리스트에 섞여</b> 온다(유저·그룹 함께 로드) — 호출측이
     *     {@code gm.group.id} 로 접어 쓴다. 그룹 순서는 보장되지 않고, 멤버가 없는 그룹은 아예 빠진다
     */
    @EntityGraph(attributePaths = {"user", "group"})
    @Query("SELECT gm FROM GroupMember gm WHERE gm.group.id IN :groupIds AND gm.isLeft = false")
    List<GroupMember> findByGroupIdIn(@Param("groupIds") Collection<UUID> groupIds);

    /**
     * getMyGroups 가 멤버마다 group.getName()/getMaxMembers()/getStatus()/isPrivate() 를 읽는다.
     * GroupMember.group 은 LAZY 라 fetch 하지 않으면 그룹 수 N 만큼 SELECT 가 더 나간다 — 멤버 수
     * 집계를 IN 1회로 줄여도 전체 쿼리는 여전히 N 에 비례했다. 그룹을 함께 로드해 2회로 고정한다.
     *
     * @param user 내 그룹 목록을 볼 유저
     * @return 이 유저가 현재 속한 멤버십 전량(그룹 함께 로드). 상한이 있어 길어지지 않는다.
     *     <b>그룹의 종료·삭제 여부를 보지 않으므로</b> 끝났거나 지워진 방의 멤버십도 실린다
     */
    @EntityGraph(attributePaths = "group")
    @Query("SELECT gm FROM GroupMember gm WHERE gm.user = :user AND gm.isLeft = false")
    List<GroupMember> findByUser(@Param("user") User user);

    /**
     * 활성 멤버십만 — 강퇴/탈퇴(is_left)는 없는 것으로 본다(멤버십 검증·권한 판정 공용).
     *
     * @param user 검증할 유저
     * @param group 검증할 그룹
     * @return 활성 멤버십 1건. empty 는 "가입한 적 없음"과 "나갔음"을 구분하지 않는다 — 호출측은 둘 다
     *     {@code MEMBER_ONLY} 로 접는다. 락이 없어 조회 직후 탈퇴가 커밋될 수 있으므로, 돈이 걸린
     *     경로는 잠금판({@link #findActiveByUserIdAndGroupIdForShare})을 써야 한다
     */
    @Query("SELECT gm FROM GroupMember gm WHERE gm.user = :user AND gm.group = :group AND gm.isLeft = false")
    Optional<GroupMember> findByUserAndGroup(@Param("user") User user, @Param("group") Group group);

    /**
     * 초대 링크 발급(invitelink 도메인)의 멤버십 검증용 — 활성 멤버(is_left=false)만 멤버로 본다.
     * A-0 소프트삭제 이후 탈퇴/강퇴는 행을 지우지 않고 is_left=true 로 마킹만 하므로, 필터 없이
     * 존재만 물으면 나간/강퇴된 유저가 여전히 '멤버'로 잡혀 초대 링크를 계속 발급할 수 있다 —
     * 다른 활성 조회(findByUserAndGroup 등)와 같은 기준(is_left=false)으로 맞춘다.
     *
     * @param groupId 초대 링크를 발급하려는 그룹
     * @param userId 발급을 요청한 유저
     * @return 활성 멤버면 true. 엔티티를 안 쓰는 호출부(invitelink 도메인)를 위해 존재만 돌려준다 —
     *     역할·권한은 보지 않으므로 "누가 초대할 수 있는가"는 별도 판정이다
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
     *
     * @param userId 참여하려는 유저
     * @param groupId 참여 대상 회차가 속한 그룹
     * @return 공유 락이 걸린 활성 멤버십. <b>empty 는 곧 "이미 나갔다"</b>이고 호출측은 403 으로 끊는다.
     *     참여끼리는 서로 막지 않고 탈퇴의 배타 락과만 줄을 선다. readOnly 트랜잭션에서는 쓸 수 없다
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
     *
     * @param userId 그룹을 떠나는 유저
     * @param groupId 떠나는 그룹
     * @return 배타 락이 걸린 활성 멤버십. empty 면 이미 떠난 뒤라 정리할 것이 없다는 뜻이다.
     *     같은 행을 노리는 참여 트랜잭션이 있으면 <b>대기</b>한다. readOnly 트랜잭션에서는 쓸 수 없다
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
     *
     * @param user 참여를 시도하는 유저
     * @param group 참여 대상 그룹
     * @return 이탈 여부를 <b>가리지 않은</b> 멤버십 1건 — 이 리포지토리에서 유일하게 떠난 행까지 보는
     *     조회다. present 라고 멤버라는 뜻이 아니므로 호출측이 {@code isLeft}·{@code isKicked} 를 직접
     *     읽어 재가입/거절을 가른다. empty 여야만 새 행을 넣을 수 있다(유니크 제약)
     */
    @Query("SELECT gm FROM GroupMember gm WHERE gm.user = :user AND gm.group = :group")
    Optional<GroupMember> findAnyByUserAndGroup(@Param("user") User user, @Param("group") Group group);

    /**
     * A-2: 계정 탈퇴 시 방장으로 남은 그룹 정리용 — 유저가 현재 방장(활성)인 멤버십과 그 그룹.
     * 혼자인 그룹은 자동 종료하고, 다른 멤버가 있으면 위임이 필요해 탈퇴가 막힌다(HOST_WITHDRAW).
     *
     * @param userId 계정 탈퇴를 시도하는 유저
     * @return 아직 방장으로 남아 있는 활성 멤버십과 그 그룹. 빈 리스트여야 탈퇴가 바로 통과한다 —
     *     비어 있지 않으면 그룹마다 자동 종료 또는 위임 요구로 갈린다
     */
    @EntityGraph(attributePaths = "group")
    @Query("SELECT gm FROM GroupMember gm WHERE gm.user.id = :userId "
            + "AND gm.role = com.oneorthree.phone.group.repository.domain.GroupMemberRole.OWNER AND gm.isLeft = false")
    List<GroupMember> findActiveOwnerMembershipsByUserId(@Param("userId") UUID userId);

    /**
     * 멀티 그룹 상한(MAX_JOINED_GROUPS) 검사용 — findByUser(내 그룹 목록)와 같은 모수(활성만).
     *
     * @param user 참여를 시도하는 유저
     * @return 현재 속한 그룹 수. 모수를 목록과 같게 두는 것이 핵심이다 — 갈리면 "목록엔 N개인데 더는
     *     못 들어간다"가 된다. 락 없이 도는 검사라 동시 참여 2건이 상한을 넘길 여지는 남아 있다
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
     *
     * @param groupIds 인원수를 붙일 그룹 id 들. 빈 컬렉션이면 빈 결과다
     * @return 그룹당 1행 — <b>멤버가 0인 그룹은 행 자체가 없으므로</b> 호출측이 0으로 채워야 한다
     *     (결손을 "조회 실패"로 다루면 안 된다). 순서는 보장되지 않는다
     */
    @Query("SELECT gm.group.id AS groupId, COUNT(gm) AS memberCount FROM GroupMember gm"
            + " WHERE gm.group.id IN :groupIds AND gm.isLeft = false AND gm.user.isDeleted = false"
            + " GROUP BY gm.group.id")
    List<GroupMemberCount> countByGroupIdIn(@Param("groupIds") Collection<UUID> groupIds);

    /** {@link #countByGroupIdIn} 결과 행 — 그룹 id 와 그 그룹의 멤버 수. */
    interface GroupMemberCount {
        /** @return 집계 대상 그룹 id — 호출측이 이 값으로 요청한 id 목록에 다시 맞춘다. */
        UUID getGroupId();

        /**
         * @return 활성·미탈퇴 멤버 수. 최소 1이다 — 0인 그룹은 행이 아예 나오지 않기 때문이다.
         *     정원 판정({@code activeMembersOf})과 같은 모수라 "목록 N명 · 카운트 N+1명"이 생기지 않는다
         */
        long getMemberCount();
    }
}
