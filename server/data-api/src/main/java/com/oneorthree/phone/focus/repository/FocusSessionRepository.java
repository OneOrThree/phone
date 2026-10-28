package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.user.repository.domain.User;
import jakarta.persistence.LockModeType;
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
 * 집중 세션 기본 행의 저장·조회 지점.
 *
 * <p>진행 여부는 종료 시각으로 확인한다. 잠금 조회와 조건부 갱신을 제공하며,
 * 벌크 갱신은 이미 로드된 엔티티를 자동으로 새로 고치지 않는다.
 */
public interface FocusSessionRepository extends JpaRepository<FocusSession, UUID> {



    /**
     * 소유자 조건을 확인하며 기본 세션을 배타 잠근다.
     *
     * @param id 세션 id
     * @param user 소유자
     * @return 잠긴 세션. 없거나 소유자가 다르면 빈 값
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT s FROM FocusSession s WHERE s.id = :id AND s.user = :user")
    Optional<FocusSession> findByIdAndUserForUpdate(@Param("id") UUID id, @Param("user") User user);


    /**
     * 지정 사용자들의 미종료 세션을 최근 시작 순으로 조회한다.
     *
     * <p>오래된 미종료 기록은 {@code liveSince}로 제외한다. 이전 기록에 중복 마커가 있어도
     * 호출자가 가장 최근 세션을 일관되게 선택할 수 있도록 정렬한다.
     *
     * @param userIds 조회할 사용자 id
     * @param liveSince 라이브로 인정할 시작 시각의 하한
     * @return 하한 이후 시작한 미종료 세션
     */
    @Query("SELECT s FROM FocusSession s "
            + "WHERE s.user.id IN :userIds AND s.endedAt IS NULL AND s.startedAt >= :liveSince "
            + "ORDER BY s.startedAt DESC")
    List<FocusSession> findLiveSessionsByUserIdIn(@Param("userIds") Collection<UUID> userIds,
                                                  @Param("liveSince") Instant liveSince);

    /**
     * 프레즌스 재구축 대상인 미종료 세션을 조회한다.
     *
     * @param threshold 라이브로 인정할 시작 시각의 하한
     */
    @EntityGraph(attributePaths = "user")
    List<FocusSession> findByEndedAtIsNullAndStartedAtAfter(Instant threshold);


    /**
     * 방금 리스를 놓아 준 세션들 중 <b>그 사이 끝난 것</b> — 프레즌스 재구축의 되묻기(GROMO-292).
     *
     * <p>재구축은 「읽고 → 쓴다」라 그 사이에 세션이 끝날 수 있다. 보통은 종료가 남긴 «끝났다» 표식이
     * 늦은 쓰기를 막아 주지만, <b>그 종료의 Redis 쓰기가 실패했다면 표식이 없다</b>(장애 중 종료가
     * 정확히 그 경우다). 그러면 재구축이 <b>이미 끝난 집중의 리스를 새로 13시간 놓고</b>, 다음 회차
     * 조회는 {@code endedAt} 이 찬 행을 제외하므로 <b>그 리스를 치울 주체가 영영 없다.</b>
     *
     * <p>그래서 놓아 준 직후 정본에 다시 묻는다. 모수가 방금 쓴 id 목록이라 한 번의 IN 조회로 끝난다.
     *
     * @param ids 이번 회차에 리스를 놓아 준 세션 id 들
     */
    @EntityGraph(attributePaths = "user")
    List<FocusSession> findByIdInAndEndedAtIsNotNull(Collection<UUID> ids);




    /**
     * 탈퇴 시 세션에서 유저 참조만 끊는다 — 행 자체는 남긴다(집계 원본 보존, user_id 는 nullable).
     *
     * <p>벌크 UPDATE 라 영속성 컨텍스트를 우회한다. 같은 트랜잭션에서 이미 로드한 세션 엔티티는 여전히
     * 옛 user 를 들고 있고, user 가 null 이 된 행은 이후 {@code user} 조건이 붙은 모든 쿼리에서 빠진다.
     *
     * @param userId 탈퇴한 유저 id
     */
    @Modifying
    @Query("UPDATE FocusSession f SET f.user = null WHERE f.user.id = :userId")
    void nullifyUser(@Param("userId") UUID userId);




    /**
     * 마커의 종료 시각만 — 엔티티를 영속성 컨텍스트에 올리지 않는 스칼라 조회다(GROMO-1924).
     *
     * <p>finish 는 같은 TX 뒤에서 이 마커를 {@code findByIdAndUserForUpdate} 로 잠근다. 앞에서 엔티티로
     * 읽어 두면 그 잠금 조회가 잠금 «전»의 캐시 인스턴스를 돌려준다 — 상세의 {@code FocusSessionOwnership} 과
     * 같은 이유로 스칼라로 읽는다.
     *
     * @return 종료 시각. 행이 없거나 아직 열려 있으면 빈 값
     */
    @Query("SELECT s.endedAt FROM FocusSession s WHERE s.id = :id")
    Optional<Instant> findEndedAtById(@Param("id") UUID id);

    /**
     * 집중 프레즌스 순번(GROMO-1743) — 엔티티를 들고 있지 않은 종료 경로가 리스 해제에 싣는다.
     *
     * @return 순번. 행이 없거나 V77 이전에 끝난 행이면 빈 값 — 프레즌스는 그때 아무것도 하지 않는다
     */
    @Query("SELECT s.presenceOrder FROM FocusSession s WHERE s.id = :id")
    Optional<Long> findPresenceOrderById(@Param("id") UUID id);


    /**
     * 아직 열려 있는 기본 세션만 AUTO_CLOSED로 바꾼다.
     *
     * @param id 마감할 세션 id
     * @param endedAt 서버가 결정한 마감 시각
     * @return 갱신한 행 수. 이미 종료됐으면 0
     */
    @Modifying
    @Query("UPDATE FocusSession s "
            + "SET s.status = com.oneorthree.phone.focus.repository.domain.FocusSessionStatus.AUTO_CLOSED, "
            + "s.endedAt = :endedAt "
            + "WHERE s.id = :id AND s.endedAt IS NULL")
    int markAutoClosedIfOpen(@Param("id") UUID id, @Param("endedAt") Instant endedAt);

    /**
     * 사용자의 미종료 기본 세션 중 가장 최근에 시작한 행을 조회한다.
     *
     * @param user 세션 소유자
     * @return 가장 최근의 열린 세션. 없으면 빈 값
     */
    Optional<FocusSession> findFirstByUserAndEndedAtIsNullOrderByStartedAtDesc(User user);







}
