package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.user.repository.domain.User;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
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

    /** 유저의 활성 멤버십과 소속 섬을 함께 조회한다. 섬의 종료·삭제 여부는 별도로 확인한다. */
    @EntityGraph(attributePaths = "group")
    @Query("SELECT gm FROM GroupMember gm WHERE gm.user = :user AND gm.isLeft = false")
    List<GroupMember> findByUser(@Param("user") User user);

    /**
     * 유저 PK 로 활성 멤버십 전부 (GROMO-1660) — 표시정보 변경 relay 의 대상 목록이다(A22 ㋡).
     *
     * <p>{@link #findByUser} 와 나눈 이유는 <b>인자</b> 하나다. 닉네임 변경은 {@code user} 도메인에서
     * 시작하는데 그쪽은 이 도메인을 참조할 수 없어(레이어 방향) {@code User} 엔티티가 아니라 PK 만
     * 건네진다 — 여기서 유저를 다시 로드하면 그 한 번의 왕복이 순전히 타입을 맞추려는 비용이 된다.
     *
     * @param userId 유저 PK
     * @return 이탈하지 않은 멤버십 전부
     */
    @Query("SELECT gm FROM GroupMember gm WHERE gm.user.id = :userId AND gm.isLeft = false")
    List<GroupMember> findActiveMembershipsByUserId(@Param("userId") UUID userId);

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
     * 섬 주민 목록 한 페이지 (GROMO-1802, 섬 관리 LLD §3.2) — {@code (createdAt, id)} keyset 이다.
     *
     * <p>탈퇴 계정은 {@code is_left=false} 로 남아 있어도 주민으로 세지 않는다(LLD §4) — 정원 집계
     * {@link #countByGroupIdIn} 과 같은 모수다. 첫 페이지는 호출측이 어떤 행보다도 이른 경계를 넘긴다.
     *
     * @param groupId        섬
     * @param afterCreatedAt 직전 페이지 마지막 행의 가입 시각
     * @param afterId        직전 페이지 마지막 행의 멤버십 PK — 같은 시각의 동률을 끊는다
     * @param pageable       크기만 쓴다 — 정렬은 쿼리가 고정한다
     * @return 경계 뒤의 활성·미탈퇴 주민(유저 함께 로드)
     */
    @EntityGraph(attributePaths = "user")
    @Query("SELECT gm FROM GroupMember gm WHERE gm.group.id = :groupId AND gm.isLeft = false"
            + " AND gm.user.isDeleted = false"
            + " AND (gm.createdAt > :afterCreatedAt OR (gm.createdAt = :afterCreatedAt AND gm.id > :afterId))"
            + " ORDER BY gm.createdAt, gm.id")
    List<GroupMember> findActivePageByGroupId(@Param("groupId") UUID groupId,
            @Param("afterCreatedAt") Instant afterCreatedAt, @Param("afterId") UUID afterId, Pageable pageable);

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
     * 섬 초대 코드의 «발급 세대» 대조용(GROMO-1760) — 위 공유 잠금 조회와 같은 필터의 잠금 없는 판이다.
     * 초대 해석(resolve)은 조회 성격이라 행을 잠그지 않는다 — 잠금 아래의 재검증은 가입 커밋이 다시 한다.
     * 발급(issue)도 이 잠금 없는 조회로 충분하다: 발급자 본인의 users 행은 이미 배타 잠금돼 있고,
     * 발급자의 멤버십을 바꾸는 유일한 타인 경로(방장 강퇴)는 그룹 행 배타 잠금과 직렬화된다.
     *
     * @param userId 발급자·신청자의 멤버십을 볼 유저
     * @param groupId 대상 그룹
     * @return 활성 멤버십 — empty 면 «멤버가 아니다» 또는 «이미 나갔다»
     */
    @Query("SELECT gm FROM GroupMember gm WHERE gm.user.id = :userId AND gm.group.id = :groupId "
            + "AND gm.isLeft = false")
    Optional<GroupMember> findActiveByUserIdAndGroupId(
            @Param("userId") UUID userId,
            @Param("groupId") UUID groupId);

    /**
     * 그룹의 현재 방장(활성 OWNER) — 가입 요청 사건의 «방장 수신자» 를 고를 때 쓴다(GROMO-1760).
     * 활성 방장은 통상 1명이지만, 방장이 떠난 뒤 위임이 없는 결손 구간도 있을 수 있으므로
     * 목록으로 돌려주고 호출측이 첫 행을 취한다.
     */
    @Query("SELECT gm FROM GroupMember gm WHERE gm.group.id = :groupId "
            + "AND gm.role = com.oneorthree.phone.group.repository.domain.GroupMemberRole.OWNER "
            + "AND gm.isLeft = false ORDER BY gm.id")
    List<GroupMember> findActiveOwnersByGroupId(@Param("groupId") UUID groupId);

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

    /** 섬의 현재 주민 PK를 멤버십 행 순서로 조회한다. */
    @Query("SELECT gm.user.id FROM GroupMember gm "
            + "WHERE gm.group.id = :groupId AND gm.isLeft = false ORDER BY gm.id")
    List<UUID> findActiveMemberUserIdsByGroupId(@Param("groupId") UUID groupId);

    /**
     * 건설 「각자 몫」 대상 주민 판정 전용 (GROMO-1999) — 활성 멤버 중 멤버십이
     * {@code selectedAt} «까지» 시작된 사람만 돌려준다. 시작 시각은
     * {@code COALESCE(rejoinedAt, createdAt)} — 목표 선택 뒤 탈퇴→재가입한 주민은
     * {@code rejoinedAt} 이 선택 시각 뒤라 여기서 빠져, 되살아난 행의 옛 기여가 옛 epoch
     * 분모에 다시 들어가지 않는다. 시작 시각이 NULL 인 legacy 행은 «경계보다 오래된 행»으로
     * 포함한다 — {@code IslandWeeklyMemberCountRepository.ACTIVE_AT_BOUNDARY_SQL} 과 같은 판정.
     *
     * @param groupId    섬
     * @param selectedAt 목표가 선택된 시각 — {@code island_construction_states.updated_at}
     * @return 선택 시각까지 멤버십이 시작된 활성 주민의 유저 PK
     */
    @Query("SELECT gm.user.id FROM GroupMember gm "
            + "WHERE gm.group.id = :groupId AND gm.isLeft = false "
            + "AND (COALESCE(gm.rejoinedAt, gm.createdAt) IS NULL "
            + "OR COALESCE(gm.rejoinedAt, gm.createdAt) <= :selectedAt) ORDER BY gm.id")
    List<UUID> findActiveMemberUserIdsJoinedBy(@Param("groupId") UUID groupId,
            @Param("selectedAt") Instant selectedAt);

    /** 유저가 현재 소속된 섬 PK를 조회한다. */
    @Query("SELECT gm.group.id FROM GroupMember gm "
            + "WHERE gm.user.id = :userId AND gm.isLeft = false ORDER BY gm.id")
    List<UUID> findActiveGroupIdsByUserId(@Param("userId") UUID userId);

    /** 멤버십을 변경하기 전에 활성 멤버 행을 잠근다. */
    @Query(value = "SELECT id FROM group_members WHERE group_id = :groupId AND user_id = :userId "
            + "AND is_left = false FOR UPDATE", nativeQuery = true)
    Optional<UUID> lockActiveMembershipId(@Param("groupId") UUID groupId, @Param("userId") UUID userId);

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

    /** 섬별 현재 주민 수. 이탈 멤버와 탈퇴 계정을 제외하며 주민이 없는 섬은 결과에 없다. */
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

    /**
     * 탈퇴자의 <b>모든</b> 멤버십(이미 떠난 행 포함)에서 개인 설정을 비개인 기본값으로 되돌린다
     * (GROMO-1801 · 계정 LLD §4 「보존 멤버십 행의 개인 설정 초기화」). 네 열 모두 NOT NULL 이라 null 이
     * 아니라 기본값이다. user·group·is_left·left_reason·created_at 의 관계 증거는 그대로 남는다.
     *
     * <p>벌크인 이유: 활성 멤버십 조회({@link #findByUser})는 is_left=false 만 보므로 이탈 직후의 행을 못 찾는다.
     *
     * @param userId 탈퇴하는 유저
     * @return 바뀐 행 수
     */
    @Modifying(flushAutomatically = true)
    @Query("UPDATE GroupMember gm SET gm.notificationEnabled = false,"
            + " gm.announcementPermission ="
            + " com.oneorthree.phone.group.repository.domain.GroupAnnouncementGrant.DISALLOW,"
            + " gm.status = com.oneorthree.phone.group.repository.domain.GroupMemberStatus.INACTIVE,"
            + " gm.role = com.oneorthree.phone.group.repository.domain.GroupMemberRole.MEMBER"
            + " WHERE gm.user.id = :userId")
    int eraseSettingsOfUser(@Param("userId") UUID userId);

    /**
     * 메인 섬 도출·이전용 — 활성 멤버십을 <b>최근 가입 순</b>으로, 섬 이름까지 (GROMO-1971 · 2054).
     *
     * <p>한 조회가 두 질문에 답한다 — 정책(기획 정본 「남은 섬 중 가장 최근에 가입한 섬이 메인 섬이 된다」,
     * GROMO-2054)이 도출과 이전을 <b>같은 축</b>으로 묶었기 때문이다: 명시 선택이 없을 때의 메인 섬도,
     * 메인 섬을 잃었을 때 옮겨 갈 곳도 <b>첫 행</b>(가장 최근에 가입한 섬)이다. 친구 목록이 여러 사람분을
     * 한 번에 묻기 때문에 사용자 단위 루프가 아니라 {@code IN} 배치다.
     *
     * <p>정렬 축은 {@code COALESCE(rejoined_at, created_at)} — «멤버십 시작 시각»이다. {@code rejoined_at}
     * 은 티켓 2050(V97)이 넣은 컬럼이라 이 정렬은 그 컬럼에 의존한다: 자진 탈퇴 뒤 재가입하면 행이
     * 되살아나며({@code rejoin()}) {@code created_at} 은 최초 가입 시각 그대로라, {@code created_at} 만으로
     * 정렬하면 방금 재가입한 섬이 «오래전 가입»으로 밀려 도출이 틀어진다.
     *
     * <p>{@code NULLS LAST} 는 빠뜨리면 안 되는 절이다 — PostgreSQL 의 DESC 기본값은 NULLS FIRST 라,
     * {@code created_at} 까지 NULL 인 V2 이전 legacy 활성 행이 있으면 명시 없이는 그 행이 «가장 최근
     * 가입»으로 도출된다. NULL 시작 시각은 «과거 소속»이므로 실제 시각이 있는 멤버십보다 앞설 수 없다.
     *
     * @param userIds 조회 대상. 비어 있으면 빈 목록
     * @return 활성 멤버십분만, {@code (COALESCE(rejoinedAt, createdAt), id)} 내림차순·NULL 은 맨 뒤.
     *     소속이 없는 사용자는 행이 아예 빠진다
     */
    @Query("SELECT new com.oneorthree.phone.group.repository.UserIslandNameProjection("
            + "gm.user.id, gm.group.id, gm.group.name) FROM GroupMember gm"
            + " WHERE gm.user.id IN :userIds AND gm.isLeft = false"
            + " ORDER BY COALESCE(gm.rejoinedAt, gm.createdAt) DESC NULLS LAST, gm.id DESC")
    List<UserIslandNameProjection> findActiveIslandsJoinedDesc(@Param("userIds") Collection<UUID> userIds);

    /**
     * 방금 이탈 마킹된 멤버십보다 <b>나중에 시작된</b> 활성 멤버십 수 (GROMO-1971 · 2054).
     *
     * <p>메인 섬을 명시적으로 고른 적 없는 사람의 메인 섬은 «가장 최근에 가입한 활성 섬»이다. 그래서 이탈·강퇴가
     * 메인 섬을 건드렸는지는 <b>0 인가</b>로 판정한다 — 0 이면 방금 잃은 것이 그 도출값이었다.
     *
     * <p>이탈 마킹은 이 조회의 자동 플러시로 이미 반영돼 있으므로 방금 떠난 행은 세지 않는다.
     * 정렬 축이 {@link #findActiveIslandsJoinedDesc} 와 같아야 판정과 도출이 갈리지 않는다.
     *
     * @param userId       이탈한 사람
     * @param startedAt    이탈한 멤버십 행의 «시작 시각» — {@code COALESCE(rejoined_at, created_at)},
     *                     {@code GroupMember#membershipStartedAt()} 의 SQL 짝. <b>NULL 은 안 된다</b> —
     *                     NULL 비교는 SQL 에서 unknown 으로 접혀 결과가 0 이 되고 잃은 섬을 메인 상실로
     *                     오판한다. NULL 인 legacy 행은 {@link #countActiveOutrankingNullStart} 로 간다
     * @param membershipId 이탈한 멤버십 행의 id — 시작 시각 동률의 타이브레이크
     * @return 더 나중에 시작된 활성 멤버십 수. 0 이면 잃은 섬이 도출된 메인 섬이었다
     */
    @Query("SELECT COUNT(gm) FROM GroupMember gm WHERE gm.user.id = :userId AND gm.isLeft = false"
            + " AND (COALESCE(gm.rejoinedAt, gm.createdAt) > :startedAt"
            + " OR (COALESCE(gm.rejoinedAt, gm.createdAt) = :startedAt AND gm.id > :membershipId))")
    long countActiveJoinedAfter(@Param("userId") UUID userId, @Param("startedAt") Instant startedAt,
                                @Param("membershipId") UUID membershipId);

    /**
     * 시작 시각이 NULL 인 legacy 멤버십이 이탈했을 때의 짝 (GROMO-2054) — {@link #countActiveJoinedAfter}
     * 는 NULL 경계를 비교할 수 없다. NULL 행은 {@link #findActiveIslandsJoinedDesc} 의 NULLS LAST 로
     * 정렬 맨 아래이므로, 그보다 앞서는 행은 시작 시각이 있는 행 전부와 id 가 더 큰 NULL 행뿐이다.
     *
     * @param userId       이탈한 사람
     * @param membershipId 이탈한 멤버십 행의 id — NULL 행끼리의 타이브레이크
     * @return 이탈 행보다 앞서는 활성 멤버십 수. 0 이면 잃은 섬이 도출된 메인 섬이었다
     */
    @Query("SELECT COUNT(gm) FROM GroupMember gm WHERE gm.user.id = :userId AND gm.isLeft = false"
            + " AND (COALESCE(gm.rejoinedAt, gm.createdAt) IS NOT NULL OR gm.id > :membershipId)")
    long countActiveOutrankingNullStart(@Param("userId") UUID userId,
                                        @Param("membershipId") UUID membershipId);

    /**
     * 이 유저가 강퇴돼 지금 나가 있는 섬 id — 섬 요약·망원경 칸의 가입 방식을 보는 사람 기준으로 고칠 때 한 번에 읽는다
     * (GROMO-2315, {@code IslandSummaries#approvalRequiredFor}). {@link GroupMember#isKicked()} 와 같은 판정이다.
     */
    @Query("SELECT gm.group.id FROM GroupMember gm WHERE gm.user.id = :userId AND gm.isLeft = true "
            + "AND gm.leftReason = com.oneorthree.phone.group.repository.domain.GroupLeaveReason.KICKED")
    List<UUID> findKickedGroupIdsByUserId(@Param("userId") UUID userId);
}
