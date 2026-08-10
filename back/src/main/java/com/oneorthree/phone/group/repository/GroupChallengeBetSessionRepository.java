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
import org.springframework.transaction.annotation.Transactional;

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
     * 회차 lazy 개설 전용 멱등 INSERT(GROMO-1408) — {@code ON CONFLICT (bet_id, session_date)
     * DO NOTHING}. JPA {@code saveAndFlush} + 유니크 위반 catch 로는 복구가 불가능하다: Postgres 는
     * 제약 위반 즉시 <b>현재 트랜잭션을 aborted</b> 로 만들어 catch 안의 어떤 조회도 "current
     * transaction is aborted" 로 실패한다 — 승자 행으로 합류하지 못하고 join-week 전체가 500 으로
     * 무너진다. DO NOTHING 은 예외 자체를 내지 않으므로 같은 트랜잭션에서 곧바로 재조회해 승자
     * 행으로 진행할 수 있다(동시 개설 상대의 미커밋 행과 충돌하면 그 커밋까지 대기 후 DO NOTHING).
     *
     * <p>값(미션 스냅샷)은 {@code GroupBetService.newSession} 이 조립한 엔티티에서 그대로 옮긴다 —
     * 영속화 경로만 네이티브고 조립 규칙은 단일 지점 유지. status 는 항상 OPEN, 재시도 카운터는 0.
     *
     * @return 1 = 이 호출이 개설했다, 0 = 동시 개설이 선점했다(재조회로 합류)
     */
    @Modifying(flushAutomatically = true)
    @Query(value = "INSERT INTO group_challenge_bet_sessions "
            + "(id, bet_id, group_id, challenge_id, session_date, stake, goal_minutes, "
            + "mission_category, mission_type, window_start, window_end, status, "
            + "starts_at, join_closes_at, closes_at, settle_after, settle_attempts, created_at, updated_at) "
            + "VALUES (:id, :betId, :groupId, :challengeId, :sessionDate, :stake, :goalMinutes, "
            + ":missionCategory, :missionType, :windowStart, :windowEnd, 'OPEN', "
            + ":startsAt, :joinClosesAt, :closesAt, :settleAfter, 0, now(), now()) "
            + "ON CONFLICT (bet_id, session_date) DO NOTHING", nativeQuery = true)
    int insertOpenIgnoringConflict(
            @Param("id") UUID id,
            @Param("betId") UUID betId,
            @Param("groupId") UUID groupId,
            @Param("challengeId") UUID challengeId,
            @Param("sessionDate") LocalDate sessionDate,
            @Param("stake") int stake,
            @Param("goalMinutes") Integer goalMinutes,
            @Param("missionCategory") String missionCategory,
            @Param("missionType") String missionType,
            @Param("windowStart") java.time.LocalTime windowStart,
            @Param("windowEnd") java.time.LocalTime windowEnd,
            @Param("startsAt") Instant startsAt,
            @Param("joinClosesAt") Instant joinClosesAt,
            @Param("closesAt") Instant closesAt,
            @Param("settleAfter") Instant settleAfter);

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
     * 동결 감시 대상(GroupBetFreezeMonitor) — 기준일 이전의 미정산 회차 id. 엔티티가 아니라 id 만
     * 뽑는 이유는 회차 단위로 트랜잭션을 새로 열어 처리하기 때문이다(한 건 실패가 다른 건을
     * 말아먹지 않게).
     */
    @Query("SELECT s.id FROM GroupChallengeBetSession s "
            + "WHERE s.status = :status AND s.sessionDate < :beforeDate ORDER BY s.sessionDate, s.id")
    List<UUID> findIdsByStatusAndSessionDateBefore(
            @Param("status") GroupBetStatus status,
            @Param("beforeDate") LocalDate beforeDate);

    /**
     * 수동 배치(MANUAL) 대상 — <b>회차별 {@code settle_after}</b> 가 지난 OPEN 회차 id. 날짜 축
     * ({@code session_date < today})이던 종전 선택은 <b>당일 회차</b>(오전 창형 등)를 못 잡아,
     * 운영자가 당일 장애 회차를 수동 복구하지 못한 채 24h 자동 환불로 흘렀다(GROMO-1411 후속).
     * 백오프({@code next_attempt_at})는 무시한다 — 수동 복구는 운영자가 "지금" 재시도하겠다는
     * 뜻이고, 조기 호출은 settle 내부 그레이스·24h 가드가 이중 방어한다.
     */
    @Query("SELECT s.id FROM GroupChallengeBetSession s "
            + "WHERE s.status = :status AND s.settleAfter <= :now ORDER BY s.settleAfter, s.id")
    List<UUID> findIdsByStatusAndSettleAfterBefore(
            @Param("status") GroupBetStatus status,
            @Param("now") Instant now);

    /**
     * 카테고리별 수동 배치 대상 — 미션 스냅샷(GROMO-1263) 덕에 챌린지 조인 없이 회차 자체의
     * {@code missionCategory} 로 거른다(챌린지가 삭제돼도 대상 선정이 온전하다).
     */
    @Query("SELECT s.id FROM GroupChallengeBetSession s "
            + "WHERE s.status = :status AND s.settleAfter <= :now "
            + "AND s.missionCategory = :category ORDER BY s.settleAfter, s.id")
    List<UUID> findIdsByStatusAndSettleAfterBeforeAndCategory(
            @Param("status") GroupBetStatus status,
            @Param("now") Instant now,
            @Param("category") MissionCategory category);

    /**
     * 5분 정산 스캔 대상(GROMO-1269·1411) — {@code settle_after} 가 지난 OPEN 회차 중 백오프
     * ({@code next_attempt_at})가 경과한 것. <b>24h 데드라인 초과분은 백오프와 무관하게 집는다</b>
     * (OR 술어) — 백오프 캡({@code GroupBetScheduler#nextAttemptAt})과 두 겹으로, 재시도 정책이
     * 환불 시각 약속(N21)을 늦추지 못하게 한다. 인덱스는 (status, settle_after, next_attempt_at)
     * ({@code idx_group_challenge_bet_sessions_settle_scan}).
     *
     * @param now            스캔 시각
     * @param deadlineCutoff {@code now − 24h} — settle_after 가 이보다 이르면 환불 대상
     */
    @Query("SELECT s FROM GroupChallengeBetSession s "
            + "WHERE s.status = com.oneorthree.phone.group.domain.GroupBetStatus.OPEN "
            + "AND s.settleAfter <= :now "
            + "AND (s.nextAttemptAt IS NULL OR s.nextAttemptAt <= :now OR s.settleAfter <= :deadlineCutoff) "
            + "ORDER BY s.id")
    List<GroupChallengeBetSession> findDue(
            @Param("now") Instant now,
            @Param("deadlineCutoff") Instant deadlineCutoff);

    /**
     * 정산 실패 기록(GROMO-1411 백오프) — 시도 횟수 +1 과 다음 시도 시각을 <b>같은 UPDATE</b> 로
     * 쓴다. 스케줄러 빈은 의도적으로 무트랜잭션이라(건별 격리) {@code findDue} 반환 엔티티는
     * detached 다 — 필드만 바꾸면 flush 될 트랜잭션이 없어 영영 저장되지 않고 백오프가 전진하지
     * 못한다(5분마다 무한 재시도). 그래서 리포지토리 UPDATE 로 직접 쓰고, 메서드 자체 트랜잭션을
     * 연다({@code @Transactional} — 벌크 UPDATE 는 트랜잭션이 필수다).
     */
    @Transactional
    @Modifying
    @Query("UPDATE GroupChallengeBetSession s "
            + "SET s.settleAttempts = s.settleAttempts + 1, s.nextAttemptAt = :nextAttemptAt, "
            + "s.updatedAt = :now WHERE s.id = :id")
    int recordFailure(
            @Param("id") UUID id,
            @Param("nextAttemptAt") Instant nextAttemptAt,
            @Param("now") Instant now);

    /**
     * 참가 마감 인원 미달 크론 대상(GROMO-1412, N47·FR-36) — 참가 마감이 지났는데 참가자가 2명
     * 미만인 OPEN 회차 id. 정산 그레이스를 기다리지 않고 즉시 무산·환불하기 위한 스캔이다(혼자 남은
     * 참가비가 창 전체 + 30분 동안 묶이는 문제 — 기존 K1). 건별 처리는 잠금 후 재확인하므로 여기서는
     * 잠금 없이 집기만 한다. id 오름차순은 데드락 예방 규약.
     *
     * <p><b>브리지 기간에는 {@code closes_at}(회차 종료)이 실효 참가 마감이다</b> — {@code
     * join_closes_at} 이 아니다. 스냅샷의 {@code join_closes_at} 은 to-be 정의(창형 = 창 시작,
     * LLD §1.1)로 박제돼 있지만, 구앱 브리지(N36)의 참가 가드
     * ({@code GroupBetService.requireWindowStillOpen})는 여전히 <b>창 종료까지</b> 참가를 허용한다.
     * 박제값으로 무산시키면 창 시작 직후 첫 틱에 혼자인 창형 회차가 닫혀, 원래 허용된 시간 안에
     * 들어온 구앱의 두 번째 참가자가 거절된다 — 게다가 참가자가 2명 이상인 회차는 같은 시각에
     * 참가가 계속 되므로 "인원수에 따라 참가 가능 시간이 달라지는" 비일관이 생긴다. 하루형은
     * {@code join_closes_at == closes_at} 이라 이 선택으로 동작이 달라지지 않는다.
     *
     * <p>⚠️ <b>참가 마감을 {@code join_closes_at} 으로 전환(B8·N36 브리지 종료)할 때 이 술어도
     * 함께 되돌려야 한다</b> — 그때는 두 값이 같은 의미가 되므로 보정이 불필요해진다.
     */
    @Query("SELECT s.id FROM GroupChallengeBetSession s "
            + "WHERE s.status = com.oneorthree.phone.group.domain.GroupBetStatus.OPEN "
            + "AND s.closesAt <= :now "
            + "AND (SELECT COUNT(p) FROM GroupChallengeBetParticipant p WHERE p.session = s) < 2 "
            + "ORDER BY s.id")
    List<UUID> findOpenPastJoinDeadlineWithFewParticipants(@Param("now") Instant now);

    /**
     * 챌린지 삭제 연동 대상(GROMO-1272, FR-12) — 이 챌린지의 OPEN 회차 id <b>전부</b>(예약된 미래
     * 회차 포함). 호출측이 챌린지 행 배타 락 아래에서 부르고, id 오름차순으로 잠근 뒤 무효화·환불한다
     * (계약 §3 잠금 순서). 정산 완료 회차는 status 게이트로 자연히 빠진다(FR-13 — 결과 불변).
     */
    @Query("SELECT s.id FROM GroupChallengeBetSession s "
            + "WHERE s.challenge.id = :challengeId "
            + "AND s.status = com.oneorthree.phone.group.domain.GroupBetStatus.OPEN ORDER BY s.id")
    List<UUID> findOpenSessionIdsByChallengeId(@Param("challengeId") UUID challengeId);

    /**
     * 사건 알림 재훑기 대상(GROMO-1417) — 최근 종료된 회차. 호출측(BetEventNotificationService)이
     * (SETTLED, FORFEITED) 결과 + (VOIDED, REFUNDED) 환불 통지(N48)를 함께 넘긴다.
     * UNUSED 는 0명 회차라 알릴 대상 자체가 없다(N52 알림 제외).
     */
    @Query("SELECT s FROM GroupChallengeBetSession s JOIN FETCH s.group JOIN FETCH s.challenge "
            + "WHERE s.status IN :statuses AND s.settledAt >= :since ORDER BY s.settledAt, s.id")
    List<GroupChallengeBetSession> findByStatusInAndSettledAtSince(
            @Param("statuses") Collection<GroupBetStatus> statuses,
            @Param("since") Instant since);

    /**
     * 사일런트 flush 푸시 대상(GROMO-1281, FR-22) — <b>{@code settle_after} − 15분</b> 창에 든
     * OPEN 회차(HLD §6 시각 표 · LLD §2.1 · PRD). 큐가 비워질 시간을 남기되 정산 직전이라
     * 마지막 보고분이 판정에 반영된다. 호출측이 {@code leadCutoff = now + 15분} 을 넘겨
     * {@code settle_after − 15분 ≤ now < settle_after} 를 표현한다 — 5분 크론이 이 15분 폭을 3틱
     * 훑지만 회차 단위 클레임이 첫 틱만 통과시킨다.
     *
     * <p><b>제외는 {@code SCREEN_TIME × DURATION} 하나뿐</b>이다(HLD §6) — 그 조합만 11:30 별도
     * 슬롯으로 이관됐다(<b>미구현 — 후속</b>). {@code FOCUS × DURATION} 을 함께 빼면
     * {@code settle_after} 가 KST 자정+1h 라 23:45 사일런트가 영영 안 나가는데, 조용한 시간
     * (23–07)이 사일런트 예외인 이유가 정확히 이 케이스다(HLD §6).
     */
    @Query("SELECT s FROM GroupChallengeBetSession s JOIN FETCH s.group "
            + "WHERE s.status = com.oneorthree.phone.group.domain.GroupBetStatus.OPEN "
            + "AND s.settleAfter > :now AND s.settleAfter <= :leadCutoff "
            + "AND (s.missionType = com.oneorthree.phone.group.domain.MissionType.TIME_WINDOW "
            + "OR s.missionCategory = com.oneorthree.phone.group.domain.MissionCategory.FOCUS) "
            + "ORDER BY s.id")
    List<GroupChallengeBetSession> findSilentFlushTargets(
            @Param("now") Instant now,
            @Param("leadCutoff") Instant leadCutoff);

    /**
     * 참여 모집 알림 대상(GROMO-1417, N40) — <b>아직 참가할 수 있는</b> OPEN 회차
     * ({@code join_closes_at} 미도래). 발송 슬롯(창형 = 참가 마감 −30분 / 하루형 = 당일 08:00)
     * 판정은 호출측이 회차 스냅샷으로 하고, 여기서는 후보만 좁힌다. {@code until} 로 상한을 둬
     * 먼 미래의 예약 회차(join-week)까지 매 틱 끌어오지 않는다.
     */
    @Query("SELECT s FROM GroupChallengeBetSession s JOIN FETCH s.group JOIN FETCH s.challenge "
            + "WHERE s.status = com.oneorthree.phone.group.domain.GroupBetStatus.OPEN "
            + "AND s.joinClosesAt > :now AND s.joinClosesAt <= :until ORDER BY s.id")
    List<GroupChallengeBetSession> findOpenJoinableSessions(
            @Param("now") Instant now,
            @Param("until") Instant until);
}
