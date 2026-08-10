package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupBetVoidReason;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.domain.MissionCategory;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Slice;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 내기 <b>회차</b> 리포지토리(GROMO-1262) — 참가·판정·정산의 단위. 돈이 움직이는 경로는 전부
 * 회차 행 잠금({@link #findByIdForUpdate})으로 직렬화한다. 잠금 순서는 전역 규약을 따른다:
 * <b>회차 id 오름차순 → 지갑 userId 오름차순</b>, 다건 락 후 재조회(계약 §3).
 */
public interface GroupChallengeBetSessionRepository extends JpaRepository<GroupChallengeBetSession, UUID> {

    /**
     * 참가·취소 진입점 — 회차 id 와 그룹 스코프를 함께 검증하며(남의 그룹 회차에 참가·취소 불가)
     * 행을 잠근다. 참가는 "OPEN 확인 → 참가 행 삽입 + 차감"의 check-then-act 라 잠금 없이는
     * 정산·철회와 겹칠 때 방금 종료된 회차에 참가비가 묶일 수 있다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT s FROM GroupChallengeBetSession s WHERE s.id = :id AND s.group.id = :groupId")
    Optional<GroupChallengeBetSession> findByIdAndGroupIdForUpdate(
            @Param("id") UUID id,
            @Param("groupId") UUID groupId);

    /**
     * 회차 행 잠금 조회 — 참가자 목록을 읽고 돈을 움직이는 경로(정산·탈퇴 연동)의 직렬화 지점.
     * status CAS 는 상태 전이만 지킬 뿐 <b>참가자 읽기</b>는 못 지키므로, 두 경로 모두 이 잠금
     * 조회로 시작해 회차 단위로 완전히 직렬화한다(재편 전과 같은 규율 — users 락에 기대지 않는다).
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT s FROM GroupChallengeBetSession s WHERE s.id = :id")
    Optional<GroupChallengeBetSession> findByIdForUpdate(@Param("id") UUID id);

    /** 설정·날짜로 회차 1건 — 레거시 개설 브리지의 중복 검사(UNIQUE (bet_id, session_date)의 사전 검사). */
    Optional<GroupChallengeBetSession> findByBetIdAndSessionDate(UUID betId, LocalDate sessionDate);

    /**
     * 그룹 탈퇴 연동 대상 — 이 그룹에서 유저가 참가 중인 OPEN 회차 id. 실제 처리는 id 별로
     * {@link #findByIdForUpdate} 잠금 후 <b>참가 행을 재조회</b>한다(이 조회와 잠금 사이에 취소·
     * 정산이 끝났을 수 있다 — 1258 P0 이중 환불의 재발 방지 축). id 오름차순은 데드락 예방.
     */
    @Query("SELECT s.id FROM GroupChallengeBetSession s, GroupChallengeBetParticipant p "
            + "WHERE p.session = s AND s.group.id = :groupId AND p.user.id = :userId "
            + "AND s.status = com.oneorthree.phone.group.domain.GroupBetStatus.OPEN ORDER BY s.id")
    List<UUID> findOpenSessionIdsByGroupIdAndParticipantUserId(
            @Param("groupId") UUID groupId,
            @Param("userId") UUID userId);

    /**
     * 계정 탈퇴 연동 대상(GROMO-801) — 유저가 참가 중인 OPEN 회차 id 를 <b>그룹 무관 전수</b> 조회.
     * 멤버십을 경유하지 않는 이유: 강퇴는 참가·참가비를 정산용으로 남기므로 활성 멤버십이 없는
     * 유저도 OPEN 회차의 참가자일 수 있다.
     */
    @Query("SELECT s.id FROM GroupChallengeBetSession s, GroupChallengeBetParticipant p "
            + "WHERE p.session = s AND p.user.id = :userId "
            + "AND s.status = com.oneorthree.phone.group.domain.GroupBetStatus.OPEN ORDER BY s.id")
    List<UUID> findOpenSessionIdsByParticipantUserId(@Param("userId") UUID userId);

    /**
     * 조회 조립용 — 챌린지 목록의 해당 날짜 회차를 IN 절 1회로 배치 로드한다(N+1 방지). 호출측은
     * status 에 UNUSED 를 넘겨 <b>0명 종료 회차만</b> 뺀다(N52 — 결과·표시 제외 대상). 정산 결과
     * (SETTLED·FORFEITED·REFUNDED·VOIDED)는 그날의 사실이라 계속 실린다.
     */
    List<GroupChallengeBetSession> findByChallengeIdInAndSessionDateAndStatusNot(
            Collection<UUID> challengeIds, LocalDate sessionDate, GroupBetStatus status);

    /**
     * 조회 조립용 — 내일 폴백(계약 §3 응답 보수): 오늘 회차가 없는 챌린지의 내일 OPEN 회차만
     * 배치 로드한다.
     */
    List<GroupChallengeBetSession> findByChallengeIdInAndSessionDateAndStatus(
            Collection<UUID> challengeIds, LocalDate sessionDate, GroupBetStatus status);

    /**
     * 조회 조립용 — 챌린지별 <b>가장 최근 정산 회차 1건만</b> 배치 로드한다("지난 내기" 한 줄용).
     * Postgres {@code DISTINCT ON} 이 챌린지당 첫 행 하나만 남긴다. status 허용 목록은 구앱이
     * 아는 정산 결과 3종만이다 — UNUSED(0명 종료)는 결과가 아니고, VOIDED 는 신 API(B8)부터
     * 노출한다(구앱은 렌더 분기가 없다).
     */
    @Query(value = "SELECT DISTINCT ON (s.challenge_id) s.* FROM group_challenge_bet_sessions s "
            + "WHERE s.challenge_id IN (:challengeIds) "
            + "AND s.status IN ('SETTLED', 'REFUNDED', 'FORFEITED') "
            + "ORDER BY s.challenge_id, s.session_date DESC", nativeQuery = true)
    List<GroupChallengeBetSession> findLatestSettledByChallengeIds(
            @Param("challengeIds") Collection<UUID> challengeIds);

    /**
     * 종료 게이트 — {@code OPEN} 인 회차만 종료 상태로 <b>원자적으로</b> 전이시킨다(compare-and-set).
     * 무산 사유({@code voidReason})도 같은 UPDATE 로 함께 박는다(GROMO-1404) — 전이와 사유가
     * 따로 놀면 "VOIDED 인데 사유 없음" 창이 생긴다. 정상 정산·몰수는 null 을 넘긴다.
     *
     * <p>벌크 UPDATE 라 영속성 컨텍스트를 우회한다 — 호출 후 같은 트랜잭션에서 엔티티의
     * {@code status}/{@code settledAt} 을 읽지 말 것. {@code @UpdateTimestamp} 도 타지 않으므로
     * {@code updatedAt} 을 함께 써 준다.
     *
     * @return 1 = 이 트랜잭션이 종료 권한을 가져갔다, 0 = 이미 다른 트랜잭션이 가져갔다(스킵)
     */
    @Modifying(flushAutomatically = true)
    @Query("UPDATE GroupChallengeBetSession s SET s.status = :settledStatus, s.settledAt = :settledAt, "
            + "s.voidReason = :voidReason, s.updatedAt = :settledAt "
            + "WHERE s.id = :id AND s.status = com.oneorthree.phone.group.domain.GroupBetStatus.OPEN")
    int compareAndSetSettled(
            @Param("id") UUID id,
            @Param("settledStatus") GroupBetStatus settledStatus,
            @Param("voidReason") GroupBetVoidReason voidReason,
            @Param("settledAt") Instant settledAt);

    /** CAS 실패(0행) 시 "누가 어떤 상태로 끝냈는지" 를 엔티티 캐시 없이 다시 읽는다. */
    @Query("SELECT s.status FROM GroupChallengeBetSession s WHERE s.id = :id")
    Optional<GroupBetStatus> findStatusById(@Param("id") UUID id);

    /**
     * 내기 히스토리 첫 페이지 — 챌린지의 정산 결과 3종을 {@code session_date} 내림차순으로
     * 슬라이스한다. UNIQUE (bet_id, session_date) + 챌린지당 설정 1개라 날짜 단독 축에 동률이
     * 없다(재편 전 V28 부분 유니크와 같은 성질).
     */
    @Query("SELECT s FROM GroupChallengeBetSession s WHERE s.challenge.id = :challengeId "
            + "AND s.status IN :statuses ORDER BY s.sessionDate DESC")
    Slice<GroupChallengeBetSession> findSettledHistoryFirstPage(
            @Param("challengeId") UUID challengeId,
            @Param("statuses") Collection<GroupBetStatus> statuses,
            Pageable pageable);

    /** 내기 히스토리 다음 페이지 — 커서 날짜보다 과거만(strict {@code <} keyset). */
    @Query("SELECT s FROM GroupChallengeBetSession s WHERE s.challenge.id = :challengeId "
            + "AND s.status IN :statuses AND s.sessionDate < :cursorDate "
            + "ORDER BY s.sessionDate DESC")
    Slice<GroupChallengeBetSession> findSettledHistoryAfterCursor(
            @Param("challengeId") UUID challengeId,
            @Param("statuses") Collection<GroupBetStatus> statuses,
            @Param("cursorDate") LocalDate cursorDate,
            Pageable pageable);

    /**
     * 히스토리 커서 해석 — 커서(직전 페이지 마지막 항목의 회차 id)가 <b>이 챌린지의</b> 회차일 때만
     * 그 {@code session_date} 를 돌려준다(남의 챌린지 회차 id 로 임의 날짜 필터 생성 방지).
     */
    @Query("SELECT s.sessionDate FROM GroupChallengeBetSession s "
            + "WHERE s.id = :id AND s.challenge.id = :challengeId")
    Optional<LocalDate> findSessionDateByIdAndChallengeId(
            @Param("id") UUID id,
            @Param("challengeId") UUID challengeId);

    /**
     * 일 배치 대상 — 기준일 이전의 미정산 회차 id. 엔티티가 아니라 id 만 뽑는 이유는 회차 단위로
     * 트랜잭션을 새로 열어 처리하기 때문이다(한 건 실패가 다른 건을 말아먹지 않게).
     */
    @Query("SELECT s.id FROM GroupChallengeBetSession s "
            + "WHERE s.status = :status AND s.sessionDate < :beforeDate ORDER BY s.sessionDate, s.id")
    List<UUID> findIdsByStatusAndSessionDateBefore(
            @Param("status") GroupBetStatus status,
            @Param("beforeDate") LocalDate beforeDate);

    /**
     * 카테고리별 일 배치 대상 — 미션 스냅샷(GROMO-1263) 덕에 챌린지 조인 없이 회차 자체의
     * {@code missionCategory} 로 거른다(챌린지가 삭제돼도 대상 선정이 온전하다).
     */
    @Query("SELECT s.id FROM GroupChallengeBetSession s "
            + "WHERE s.status = :status AND s.sessionDate < :beforeDate "
            + "AND s.missionCategory = :category ORDER BY s.sessionDate, s.id")
    List<UUID> findIdsByStatusAndSessionDateBeforeAndCategory(
            @Param("status") GroupBetStatus status,
            @Param("beforeDate") LocalDate beforeDate,
            @Param("category") MissionCategory category);

    /**
     * 정산 결과 푸시 대상 — 최근 정산이 끝난 회차. 상태는 호출측이 (SETTLED, FORFEITED) 로 넘긴다
     * (UNUSED 는 0명 회차라 알릴 대상 자체가 없고 — N52 알림 제외 — VOIDED·REFUNDED 환불 통지는
     * BET_VOID_REFUND 푸시(B4·N48)의 몫이다).
     */
    @Query("SELECT s FROM GroupChallengeBetSession s JOIN FETCH s.group JOIN FETCH s.challenge "
            + "WHERE s.status IN :statuses AND s.settledAt >= :since ORDER BY s.settledAt, s.id")
    List<GroupChallengeBetSession> findByStatusInAndSettledAtSince(
            @Param("statuses") Collection<GroupBetStatus> statuses,
            @Param("since") Instant since);
}
