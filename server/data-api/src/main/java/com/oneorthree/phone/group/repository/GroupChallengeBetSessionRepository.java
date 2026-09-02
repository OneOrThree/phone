package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.GroupBetVoidReason;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
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
     *
     * @param id 참가·취소하려는 회차 id
     * @param groupId 요청 경로의 그룹 — 불일치면 존재해도 empty 다(남의 그룹 회차 조작 차단)
     * @return 잠긴 회차. <b>상태를 보지 않으므로</b> 이미 정산된 회차도 나온다 — OPEN 판정은 잠근
     *     뒤에 해야 의미가 있다. 같은 행을 쥔 트랜잭션이 있으면 <b>대기</b>한다.
     *     readOnly 트랜잭션에서는 쓸 수 없다
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
     *
     * @param id 잠글 회차 id. <b>그룹 검증이 없으므로</b> 유저 요청 경로가 아니라 배치·연동 전용이다
     * @return 잠긴 회차. empty 면 그 사이 회차가 지워졌다는 뜻이다("없던 일"로 삭제되는 회차가 있다).
     *     다건을 잠글 때는 반드시 id 오름차순으로 — 교차 데드락 방지 규약이다
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT s FROM GroupChallengeBetSession s WHERE s.id = :id")
    Optional<GroupChallengeBetSession> findByIdForUpdate(@Param("id") UUID id);

    /**
     * 설정·날짜로 회차 1건 — 레거시 개설 브리지의 중복 검사(UNIQUE (bet_id, session_date)의 사전 검사).
     *
     * @param betId 회차를 파생시킨 내기 설정 id
     * @param sessionDate 회차일(KST)
     * @return 이미 열린 회차. 유니크 제약 덕에 최대 1건이다. <b>락 없는 사전 검사</b>라 empty 를 믿고
     *     삽입하면 동시 개설과 충돌할 수 있다 — 실제 방어는 {@link #insertOpenIgnoringConflict} 다
     */
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
     * @param id 신규 회차 id(UUID v7) — 네이티브 경로라 호출측이 만들어 넘긴다. 충돌하면 버려진다
     * @param betId 회차를 파생시킨 내기 설정
     * @param groupId 회차가 속한 그룹(비정규화 — 그룹 내역 조회의 축)
     * @param challengeId 회차가 속한 챌린지
     * @param sessionDate 회차일(KST) — {@code betId} 와 함께 유니크 축이다
     * @param stake 참가비 <b>스냅샷</b> — 설정이 나중에 바뀌어도 이 회차의 돈 계산은 이 값으로 한다
     * @param goalMinutes 목표 분 스냅샷. null 은 V39 백필 이전 이력에서만 나오는 결손이다
     * @param missionCategory 카테고리 스냅샷(enum 이름 문자열 — 네이티브라 바인딩이 문자열이다)
     * @param missionType 미션 방식 스냅샷(enum 이름 문자열)
     * @param windowStart 창 시작(KST 벽시계) — 창형만. 하루형은 null
     * @param windowEnd 창 종료(KST 벽시계) — 창형만. 하루형은 null
     * @param startsAt 회차 시작 시각. 이 시각 전의 사용분 보고는 인정하지 않는다
     * @param joinClosesAt 참가 마감(to-be 정의) — 브리지 기간에는 실효 마감이 {@code closesAt} 이다
     * @param closesAt 회차 종료 시각
     * @param settleAfter 정산 가능 시각(그레이스 포함) — 정산 스캔과 24h 환불 데드라인의 기준축이다
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
     *
     * @param groupId 탈퇴하는 그룹 — 다른 그룹의 참가는 건드리지 않는다
     * @param userId 탈퇴하는 유저
     * @return id 오름차순 OPEN 회차 id. <b>이 목록은 스냅샷</b>이라 잠글 때쯤이면 이미 정리된 건이
     *     섞여 있을 수 있다. 빈 리스트면 이 그룹에서 정리할 참가가 없다는 뜻이다
     */
    @Query("SELECT s.id FROM GroupChallengeBetSession s, GroupChallengeBetParticipant p "
            + "WHERE p.session = s AND s.group.id = :groupId AND p.user.id = :userId "
            + "AND s.status = com.oneorthree.phone.group.repository.domain.GroupBetStatus.OPEN ORDER BY s.id")
    List<UUID> findOpenSessionIdsByGroupIdAndParticipantUserId(
            @Param("groupId") UUID groupId,
            @Param("userId") UUID userId);

    /**
     * 계정 탈퇴 연동 대상(GROMO-801) — 유저가 참가 중인 OPEN 회차 id 를 <b>그룹 무관 전수</b> 조회.
     * 멤버십을 경유하지 않는 이유: 강퇴는 참가·참가비를 정산용으로 남기므로 활성 멤버십이 없는
     * 유저도 OPEN 회차의 참가자일 수 있다.
     *
     * @param userId 계정을 탈퇴하는 유저
     * @return id 오름차순 OPEN 회차 id <b>전수</b>(그룹 무관). 스냅샷이라 건별로 잠근 뒤 참가 행을
     *     재조회해야 하고, 빈 리스트면 묶인 참가비가 없다는 뜻이다
     */
    @Query("SELECT s.id FROM GroupChallengeBetSession s, GroupChallengeBetParticipant p "
            + "WHERE p.session = s AND p.user.id = :userId "
            + "AND s.status = com.oneorthree.phone.group.repository.domain.GroupBetStatus.OPEN ORDER BY s.id")
    List<UUID> findOpenSessionIdsByParticipantUserId(@Param("userId") UUID userId);

    /**
     * 조회 조립용 — 챌린지 목록의 해당 날짜 회차를 IN 절 1회로 배치 로드한다(N+1 방지). 호출측은
     * status 에 UNUSED 를 넘겨 <b>0명 종료 회차만</b> 뺀다(N52 — 결과·표시 제외 대상). 정산 결과
     * (SETTLED·FORFEITED·REFUNDED·VOIDED)는 그날의 사실이라 계속 실린다.
     *
     * @param challengeIds 회차를 붙일 챌린지 id 들. 빈 컬렉션이면 빈 결과다
     * @param sessionDate 조회할 회차일(보통 오늘, KST)
     * @param status 제외할 상태 — 호출측은 {@code UNUSED} 를 넘긴다(0명 종료는 결과가 아니다)
     * @return 그 날 회차가 실제로 있는 챌린지만 — <b>요청의 부분집합</b>이다. 결손은 "그날 회차가
     *     없음"(개설 전이거나 마지막 참가자 취소로 삭제됨)이지 오류가 아니다
     */
    List<GroupChallengeBetSession> findByChallengeIdInAndSessionDateAndStatusNot(
            Collection<UUID> challengeIds, LocalDate sessionDate, GroupBetStatus status);

    /**
     * 조회 조립용 — 내일 폴백(계약 §3 응답 보수): 오늘 회차가 없는 챌린지의 내일 OPEN 회차만
     * 배치 로드한다.
     *
     * @param challengeIds 오늘 회차가 없어 내일을 대신 볼 챌린지 id 들
     * @param sessionDate 내일 날짜(KST)
     * @param status 호출측은 {@code OPEN} 을 넘긴다 — 아직 참가할 수 있는 회차만 폴백 대상이다
     * @return 조건에 맞는 회차만(요청의 부분집합). 빈 결과면 내일 회차도 아직 없다는 뜻이다
     */
    List<GroupChallengeBetSession> findByChallengeIdInAndSessionDateAndStatus(
            Collection<UUID> challengeIds, LocalDate sessionDate, GroupBetStatus status);

    /**
     * 조회 조립용 — 챌린지별 <b>가장 최근 정산 회차 1건만</b> 배치 로드한다("지난 내기" 한 줄용).
     * Postgres {@code DISTINCT ON} 이 챌린지당 첫 행 하나만 남긴다. status 허용 목록은 구앱이
     * 아는 정산 결과 3종만이다 — UNUSED(0명 종료)는 결과가 아니고, VOIDED 는 신 API(B8)부터
     * 노출한다(구앱은 렌더 분기가 없다).
     *
     * @param challengeIds "지난 내기" 줄을 붙일 챌린지 id 들. 빈 컬렉션이면 빈 결과다
     * @return 챌린지당 최대 1건 — 가장 최근 회차일의 정산 결과다. 상태 허용 목록이 <b>쿼리에 박혀
     *     있어</b>({@code SETTLED}·{@code REFUNDED}·{@code FORFEITED}) 파라미터로 넓힐 수 없고,
     *     {@code VOIDED}·{@code UNUSED} 회차만 있는 챌린지는 결과에서 통째로 빠진다
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
     * @param id 종료시킬 회차
     * @param settledStatus 전이할 종료 상태(결과 4종 또는 {@code UNUSED}) — 불가역이다
     * @param voidReason 무산·환불 사유. 정상 정산·몰수는 null 을 넘긴다
     * @param settledAt 종료 시각 — {@code updatedAt} 에도 같은 값을 쓴다(벌크라
     *     {@code @UpdateTimestamp} 가 타지 않기 때문이다)
     * @return 1 = 이 트랜잭션이 종료 권한을 가져갔다, 0 = 이미 다른 트랜잭션이 가져갔다(스킵)
     */
    @Modifying(flushAutomatically = true)
    @Query("UPDATE GroupChallengeBetSession s SET s.status = :settledStatus, s.settledAt = :settledAt, "
            + "s.voidReason = :voidReason, s.updatedAt = :settledAt "
            + "WHERE s.id = :id AND s.status = com.oneorthree.phone.group.repository.domain.GroupBetStatus.OPEN")
    int compareAndSetSettled(
            @Param("id") UUID id,
            @Param("settledStatus") GroupBetStatus settledStatus,
            @Param("voidReason") GroupBetVoidReason voidReason,
            @Param("settledAt") Instant settledAt);

    /**
     * CAS 실패(0행) 시 "누가 어떤 상태로 끝냈는지" 를 엔티티 캐시 없이 다시 읽는다.
     *
     * @param id 상태를 확인할 회차
     * @return 지금 DB 에 있는 상태. 스칼라만 뽑아 <b>1차 캐시의 낡은 엔티티를 피하는 것</b>이 이
     *     메서드의 존재 이유다. empty 면 회차 자체가 사라졌다는 뜻이다
     */
    @Query("SELECT s.status FROM GroupChallengeBetSession s WHERE s.id = :id")
    Optional<GroupBetStatus> findStatusById(@Param("id") UUID id);

    /**
     * 내기 히스토리 첫 페이지 — 챌린지의 정산 결과 3종을 {@code session_date} 내림차순으로
     * 슬라이스한다. UNIQUE (bet_id, session_date) + 챌린지당 설정 1개라 날짜 단독 축에 동률이
     * 없다(재편 전 V28 부분 유니크와 같은 성질).
     *
     * @param challengeId 이력을 볼 챌린지
     * @param statuses 실을 종료 상태들 — 호출측이 결과 목록을 넘긴다
     * @param pageable 페이지 크기. 정렬은 쿼리가 이미 박고 있으므로 여기에 넣지 않는다
     * @return 회차일 내림차순 한 페이지. {@code Slice} 라 <b>전체 건수를 세지 않는다</b>(count 쿼리 없음) —
     *     다음 페이지 유무만 알 수 있다
     */
    @Query("SELECT s FROM GroupChallengeBetSession s WHERE s.challenge.id = :challengeId "
            + "AND s.status IN :statuses ORDER BY s.sessionDate DESC")
    Slice<GroupChallengeBetSession> findSettledHistoryFirstPage(
            @Param("challengeId") UUID challengeId,
            @Param("statuses") Collection<GroupBetStatus> statuses,
            Pageable pageable);

    /**
     * 내기 히스토리 다음 페이지 — 커서 날짜보다 과거만(strict {@code <} keyset).
     *
     * @param challengeId 이력을 볼 챌린지
     * @param statuses 실을 종료 상태들
     * @param cursorDate 직전 페이지 마지막 회차일 — <b>그 날짜 자신은 제외</b>된다(날짜 동률이 없어
     *     안전하다). 값의 출처는 {@link #findSessionDateByIdAndChallengeId} 다
     * @param pageable 페이지 크기
     * @return 커서보다 과거인 회차 한 페이지(회차일 내림차순). 빈 슬라이스면 이력의 끝이다
     */
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
     *
     * @param id 클라가 보낸 커서(직전 페이지 마지막 회차 id)
     * @param challengeId 지금 보고 있는 챌린지 — 이 검증이 커서 위조 방어다
     * @return 커서 회차의 날짜. empty 는 "없는 id" 와 "남의 챌린지 회차"를 구분하지 않으며, 그 경우
     *     호출측은 잘못된 커서로 취급한다(임의 날짜로 필터를 만들 수 없다)
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
     *
     * @param status 감시할 상태 — 호출측은 {@code OPEN} 을 넘긴다(끝난 회차는 동결이 아니다)
     * @param beforeDate 이 날짜 <b>미만</b>(포함하지 않음)의 회차만. 보통 오늘이라 "어제까지 안 끝난 것"이다
     * @return 회차일·id 오름차순 id 목록. 빈 리스트가 정상이고, 비어 있지 않다면 정산이 막힌 회차가
     *     있다는 경보다
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
     *
     * @param status 호출측은 {@code OPEN} 을 넘긴다
     * @param now 기준 시각 — {@code settle_after <= now} 인 회차를 집는다(당일 회차도 포함된다)
     * @return {@code settle_after}·id 오름차순 id 목록. <b>백오프({@code next_attempt_at})를 무시</b>하므로
     *     자동 스캔이 아직 건드리지 않는 회차도 나온다. 빈 리스트면 지금 수동 정산할 대상이 없다
     */
    @Query("SELECT s.id FROM GroupChallengeBetSession s "
            + "WHERE s.status = :status AND s.settleAfter <= :now ORDER BY s.settleAfter, s.id")
    List<UUID> findIdsByStatusAndSettleAfterBefore(
            @Param("status") GroupBetStatus status,
            @Param("now") Instant now);

    /**
     * 카테고리별 수동 배치 대상 — 미션 스냅샷(GROMO-1263) 덕에 챌린지 조인 없이 회차 자체의
     * {@code missionCategory} 로 거른다(챌린지가 삭제돼도 대상 선정이 온전하다).
     *
     * @param status 호출측은 {@code OPEN} 을 넘긴다
     * @param now 기준 시각 — {@code settle_after <= now}
     * @param category 좁힐 카테고리. 회차 <b>스냅샷</b>을 보므로 챌린지가 삭제됐거나 값이 바뀌어도
     *     선정 결과가 흔들리지 않는다
     * @return {@code settle_after}·id 오름차순 id 목록. 위와 마찬가지로 백오프를 무시한다
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
     * @return id 오름차순 정산 대상 회차 <b>엔티티</b>(id 가 아니다 — 스케줄러가 곧바로 판정에 쓴다).
     *     스케줄러 빈이 무트랜잭션이라 이 엔티티들은 <b>detached</b> 이고, 필드를 고쳐도 저장되지
     *     않는다({@link #recordFailure} 가 UPDATE 로 직접 쓰는 이유다). 빈 리스트면 이번 틱에 정산할
     *     회차가 없다는 뜻이다
     */
    @Query("SELECT s FROM GroupChallengeBetSession s "
            + "WHERE s.status = com.oneorthree.phone.group.repository.domain.GroupBetStatus.OPEN "
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
     *
     * @param id 정산에 실패한 회차
     * @param nextAttemptAt 다음 시도 시각(백오프). 캡이 걸려 있어 24h 환불 약속을 넘기지 못한다
     * @param now 갱신 시각 — 벌크라 {@code @UpdateTimestamp} 가 타지 않아 {@code updatedAt} 에 직접 쓴다
     * @return 갱신된 행 수(1 = 기록됨, 0 = 회차가 사라졌다). 벌크 UPDATE 라 <b>영속성 컨텍스트를
     *     우회</b>하므로, 같은 트랜잭션에 로드돼 있던 엔티티의 {@code settleAttempts} 는 낡은 채 남는다
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
     *
     * @param now 크론 틱 시각 — {@code closes_at <= now} 로 "참가 마감이 지난"을 표현한다
     * @return id 오름차순 무산 후보 회차 id. <b>잠금 없는 스냅샷</b>이라 건별로 잠근 뒤 인원을 다시
     *     세야 한다. 참가자 0명 회차도 걸리고, 그쪽은 {@code UNUSED}(환불 대상 없음)로 종결된다
     */
    @Query("SELECT s.id FROM GroupChallengeBetSession s "
            + "WHERE s.status = com.oneorthree.phone.group.repository.domain.GroupBetStatus.OPEN "
            + "AND s.closesAt <= :now "
            + "AND (SELECT COUNT(p) FROM GroupChallengeBetParticipant p WHERE p.session = s) < 2 "
            + "ORDER BY s.id")
    List<UUID> findOpenPastJoinDeadlineWithFewParticipants(@Param("now") Instant now);

    /**
     * 챌린지 삭제 연동 대상(GROMO-1272, FR-12) — 이 챌린지의 OPEN 회차 id <b>전부</b>(예약된 미래
     * 회차 포함). 호출측이 챌린지 행 배타 락 아래에서 부르고, id 오름차순으로 잠근 뒤 무효화·환불한다
     * (계약 §3 잠금 순서). 정산 완료 회차는 status 게이트로 자연히 빠진다(FR-13 — 결과 불변).
     *
     * @param challengeId 삭제되는 챌린지
     * @return id 오름차순 OPEN 회차 id 전부(미래 예약 포함). 빈 리스트면 환불할 참가비가 없어
     *     삭제가 그대로 끝난다는 뜻이다
     */
    @Query("SELECT s.id FROM GroupChallengeBetSession s "
            + "WHERE s.challenge.id = :challengeId "
            + "AND s.status = com.oneorthree.phone.group.repository.domain.GroupBetStatus.OPEN ORDER BY s.id")
    List<UUID> findOpenSessionIdsByChallengeId(@Param("challengeId") UUID challengeId);

    /**
     * 사건 알림 재훑기 대상(GROMO-1417) — 최근 종료된 회차. 호출측(BetEventNotificationService)이
     * (SETTLED, FORFEITED) 결과 + (VOIDED, REFUNDED) 환불 통지(N48)를 함께 넘긴다.
     * UNUSED 는 0명 회차라 알릴 대상 자체가 없다(N52 알림 제외).
     *
     * @param statuses 알림 대상 종료 상태들 — {@code UNUSED} 는 넘기지 않는다(알릴 사람이 없다)
     * @param since {@code settledAt} 하한(포함) — 재훑기 창의 시작이다. 너무 좁으면 유실분을 못 줍고,
     *     너무 넓으면 매 틱 같은 회차를 다시 훑는다(중복 발송은 알림 로그가 막는다)
     * @return {@code settledAt}·id 오름차순 회차(그룹·챌린지 함께 로드). 빈 리스트면 이번 창에 새로
     *     끝난 회차가 없다는 뜻이다
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
     * <p><b>제외는 {@code SCREEN_TIME × DURATION} 하나뿐</b>이다(HLD §6). {@code FOCUS × DURATION}
     * 을 함께 빼면 {@code settle_after} 가 KST 자정+1h 라 23:45 사일런트가 영영 안 나가는데,
     * 조용한 시간(23–07)이 사일런트 예외인 이유가 정확히 이 케이스다(HLD §6).
     *
     * <p>⚠️ <b>제외된 조합의 대체 트리거는 아직 없다</b>. HLD §6(638–641행)은 이 조합을 여기서
     * 빼는 대신 <b>11:30 에 별도 사일런트</b>를 보내기로 정했지만 <b>그 11:30 트리거는 구현되지
     * 않았다</b> — 즉 {@code SCREEN_TIME × DURATION} 참가자는 12:00 정산 전에 사일런트 flush 를
     * <b>한 번도 받지 못한다</b>. 앱이 백그라운드면 최신 {@code daily_screen_time_stats} 가 안
     * 올라와 미보고가 미달성으로 확정될 수 있다. 사일런트 푸시로 메울 수 있는 문제인지부터
     * 정책 축에서 다시 정하기로 해 <b>별도 후속 티켓</b>으로 뺐다(GROMO-1417 8차 리뷰 판정).
     *
     * @param now 크론 틱 시각 — 창의 하한({@code settle_after > now}, 아직 정산 전)
     * @param leadCutoff {@code now + 15분} — 창의 상한. 두 값이 함께
     *     {@code settle_after − 15분 ≤ now < settle_after} 를 표현한다
     * @return id 오름차순 사일런트 대상 회차(그룹 함께 로드). <b>{@code SCREEN_TIME × DURATION} 은
     *     빠져 있다</b>(대체 트리거 미구현 — 위 경고 참조). 5분 크론이 15분 폭을 3틱 훑으므로 같은
     *     회차가 여러 번 나오고, 중복 발송은 회차 단위 클레임이 막는다
     */
    @Query("SELECT s FROM GroupChallengeBetSession s JOIN FETCH s.group "
            + "WHERE s.status = com.oneorthree.phone.group.repository.domain.GroupBetStatus.OPEN "
            + "AND s.settleAfter > :now AND s.settleAfter <= :leadCutoff "
            + "AND (s.missionType = com.oneorthree.phone.group.repository.domain.MissionType.TIME_WINDOW "
            + "OR s.missionCategory = com.oneorthree.phone.group.repository.domain.MissionCategory.FOCUS) "
            + "ORDER BY s.id")
    List<GroupChallengeBetSession> findSilentFlushTargets(
            @Param("now") Instant now,
            @Param("leadCutoff") Instant leadCutoff);

    /**
     * 참여 모집 알림 대상(GROMO-1417, N40) — <b>아직 참가할 수 있는</b> OPEN 회차
     * ({@code join_closes_at} 미도래). 발송 슬롯(창형 = 참가 마감 −30분 / 하루형 = 당일 08:00)
     * 판정은 호출측이 회차 스냅샷으로 하고, 여기서는 후보만 좁힌다. {@code until} 로 상한을 둬
     * 먼 미래의 예약 회차(join-week)까지 매 틱 끌어오지 않는다.
     *
     * @param now 하한 — {@code join_closes_at > now}(아직 참가 가능)
     * @param until 상한 — 이 시각까지 마감되는 회차만 후보로 본다. 없으면 join-week 로 예약된 먼
     *     미래 회차까지 매 틱 끌려온다
     * @return id 오름차순 모집 알림 후보(그룹·챌린지 함께 로드) — <b>발송 대상이 아니라 후보</b>다.
     *     실제 발송 슬롯 판정은 호출측이 회차 스냅샷으로 한다
     */
    @Query("SELECT s FROM GroupChallengeBetSession s JOIN FETCH s.group JOIN FETCH s.challenge "
            + "WHERE s.status = com.oneorthree.phone.group.repository.domain.GroupBetStatus.OPEN "
            + "AND s.joinClosesAt > :now AND s.joinClosesAt <= :until ORDER BY s.id")
    List<GroupChallengeBetSession> findOpenJoinableSessions(
            @Param("now") Instant now,
            @Param("until") Instant until);

    /**
 * 창 사용분 보고의 <b>대상 회차</b>(GROMO-1407, N34·N43) — 보고 날짜({@code usageDate})에
     * 해당하는 이 챌린지의 회차. 설정이 챌린지당 1개(uq_group_challenge_bets_challenge)이고 회차가
     * (설정, 날짜)당 1개라 결과는 최대 1건이다.
     *
     * <p>보고 자격·직렬화가 <b>이 회차에 결속</b>된다: 참가자는 이 날짜의 회차가 시작됐고 OPEN 일
     * 때만 저장할 수 있다. 챌린지 단위로 "아무 OPEN 회차 참가자면 통과"로 두면, 오늘 회차 참가자가
     * 함께 예약한 <b>미래 회차가 시작되기도 전에 그 날짜의 낮은 사용량을 미리 심을</b> 수 있다.
     *
     * @param challengeId 보고가 겨눈 챌린지
     * @param sessionDate 보고 귀속일(KST) — 보고 시각이 아니라 어느 날의 사용분인가다
     * @return 그 날짜의 회차(유니크 축 덕에 최대 1건). empty 면 아직 개설되지 않았거나 삭제된
     *     회차라 보고를 받을 수 없다는 뜻이다. <b>상태를 보지 않으므로</b> OPEN 여부는 호출측이 본다
     */
    @Query("SELECT s FROM GroupChallengeBetSession s "
            + "WHERE s.challenge.id = :challengeId AND s.sessionDate = :sessionDate")
    Optional<GroupChallengeBetSession> findByChallengeIdAndSessionDate(
            @Param("challengeId") UUID challengeId,
            @Param("sessionDate") LocalDate sessionDate);

    /**
     * 삭제 프리플라이트(GROMO-1416, N49·K11) — 이 챌린지의 OPEN 회차 전부(예약된 미래 포함)를
     * 날짜순으로. 잠금 없는 순수 조회다 — 경고 수치는 스냅샷이고, 실제 무효화는 DELETE 가 락 아래
     * 다시 센다.
     *
     * @param challengeId 삭제 예고 중인 챌린지
     * @param status 호출측은 {@code OPEN} 을 넘긴다 — 정산 끝난 회차는 삭제해도 그대로 남는다(FR-13)
     * @return 회차일·id 오름차순 회차 엔티티. 화면에 "며칠치 회차가 무효화된다"를 보여 주기 위한
     *     것이라 <b>확정값이 아니다</b> — 실제 삭제 시점에 다시 센다. 빈 리스트면 경고 없이 삭제된다
     */
    List<GroupChallengeBetSession> findByChallengeIdAndStatusOrderBySessionDateAscIdAsc(
            UUID challengeId, GroupBetStatus status);

    /**
     * 그룹 내역 커서 해석(GROMO-1271) — 커서 회차가 <b>이 그룹의</b> 것일 때만(타 그룹 id 로 필터 생성 방지).
     *
     * @param id 클라가 보낸 커서(직전 페이지 마지막 회차 id)
     * @param groupId 지금 보고 있는 그룹 — 이 검증이 커서 위조 방어다
     * @return 커서 회차. 호출측은 여기서 {@code sessionDate} 와 id 를 꺼내 튜플 keyset 을 만든다.
     *     empty 는 없는 id 와 남의 그룹 회차를 구분하지 않고, 둘 다 잘못된 커서로 취급된다
     */
    Optional<GroupChallengeBetSession> findByIdAndGroupId(UUID id, UUID groupId);

    /**
     * 그룹 챌린지 내역 첫 페이지(GROMO-1271, N6-1) — 그룹 소유 축이라 챌린지 삭제와 무관하게
     * 조회된다(표시 값은 회차 미션 스냅샷). UNUSED(0명 종료)는 호출측 statuses 에서 이미 빠져 있다
     * (N52). 같은 날짜에 챌린지별 회차가 최대 4개라 (session_date, id) 튜플 keyset 이다 — 날짜만으로
     * 자르면 페이지 경계의 같은 날 나머지가 스킵/중복된다. challenge 는 삭제 배지 판정에 쓰므로
     * 함께 fetch 한다(행당 추가 SELECT 방지).
     *
     * @param groupId 내역을 볼 그룹
     * @param statuses 실을 종료 상태들 — 호출측이 {@code UNUSED} 를 빼고 넘긴다(N52)
     * @param pageable 페이지 크기. 정렬은 쿼리가 박고 있다
     * @return 회차일·id 내림차순 한 페이지(챌린지 함께 로드). <b>삭제된 챌린지의 회차도 실린다</b> —
     *     소유 축이 그룹이라 그렇고, 표시값은 회차 스냅샷이라 온전하다. {@code Slice} 라 전체 건수는
     *     세지 않는다
     */
    @Query("SELECT s FROM GroupChallengeBetSession s JOIN FETCH s.challenge "
            + "WHERE s.group.id = :groupId AND s.status IN :statuses "
            + "ORDER BY s.sessionDate DESC, s.id DESC")
    Slice<GroupChallengeBetSession> findGroupHistoryFirstPage(
            @Param("groupId") UUID groupId,
            @Param("statuses") Collection<GroupBetStatus> statuses,
            Pageable pageable);

    /**
     * 그룹 챌린지 내역 다음 페이지 — (session_date, id) 튜플 strict 비교 keyset.
     *
     * @param groupId 내역을 볼 그룹
     * @param statuses 실을 종료 상태들
     * @param cursorDate 커서 회차일
     * @param cursorId 커서 회차 id — <b>날짜만으로 자르면 안 되는 이유</b>가 여기 있다. 같은 날
     *     챌린지별 회차가 여럿이라 날짜 단독 커서는 경계의 나머지를 건너뛰거나 중복시킨다
     * @param pageable 페이지 크기
     * @return 커서보다 뒤인 회차 한 페이지. 빈 슬라이스면 내역의 끝이다
     */
    @Query("SELECT s FROM GroupChallengeBetSession s JOIN FETCH s.challenge "
            + "WHERE s.group.id = :groupId AND s.status IN :statuses "
            + "AND (s.sessionDate < :cursorDate "
            + "OR (s.sessionDate = :cursorDate AND s.id < :cursorId)) "
            + "ORDER BY s.sessionDate DESC, s.id DESC")
    Slice<GroupChallengeBetSession> findGroupHistoryAfterCursor(
            @Param("groupId") UUID groupId,
            @Param("statuses") Collection<GroupBetStatus> statuses,
            @Param("cursorDate") LocalDate cursorDate,
            @Param("cursorId") UUID cursorId,
            Pageable pageable);

    /**
     * 그룹 챌린지 내역 첫 페이지 — 챌린지 필터판(챌린지별 이력 화면). 그룹 스코프는 유지된다.
     *
     * @param groupId 내역을 볼 그룹 — 챌린지 id 를 받아도 그룹 검증을 떼지 않는다(남의 그룹 이력 차단)
     * @param challengeId 좁힐 챌린지
     * @param statuses 실을 종료 상태들
     * @param pageable 페이지 크기
     * @return 회차일·id 내림차순 한 페이지(챌린지 함께 로드). 챌린지가 삭제됐어도 이력은 그대로 나온다
     */
    @Query("SELECT s FROM GroupChallengeBetSession s JOIN FETCH s.challenge "
            + "WHERE s.group.id = :groupId AND s.challenge.id = :challengeId AND s.status IN :statuses "
            + "ORDER BY s.sessionDate DESC, s.id DESC")
    Slice<GroupChallengeBetSession> findGroupHistoryFirstPageByChallenge(
            @Param("groupId") UUID groupId,
            @Param("challengeId") UUID challengeId,
            @Param("statuses") Collection<GroupBetStatus> statuses,
            Pageable pageable);

    /**
     * 그룹 챌린지 내역 다음 페이지 — 챌린지 필터판.
     *
     * @param groupId 내역을 볼 그룹
     * @param challengeId 좁힐 챌린지
     * @param statuses 실을 종료 상태들
     * @param cursorDate 커서 회차일
     * @param cursorId 커서 회차 id — 챌린지로 좁혀도 튜플 keyset 을 유지한다(필터 없는 판과 같은 규칙)
     * @param pageable 페이지 크기
     * @return 커서보다 뒤인 회차 한 페이지. 빈 슬라이스면 이 챌린지 이력의 끝이다
     */
    @Query("SELECT s FROM GroupChallengeBetSession s JOIN FETCH s.challenge "
            + "WHERE s.group.id = :groupId AND s.challenge.id = :challengeId AND s.status IN :statuses "
            + "AND (s.sessionDate < :cursorDate "
            + "OR (s.sessionDate = :cursorDate AND s.id < :cursorId)) "
            + "ORDER BY s.sessionDate DESC, s.id DESC")
    Slice<GroupChallengeBetSession> findGroupHistoryAfterCursorByChallenge(
            @Param("groupId") UUID groupId,
            @Param("challengeId") UUID challengeId,
            @Param("statuses") Collection<GroupBetStatus> statuses,
            @Param("cursorDate") LocalDate cursorDate,
            @Param("cursorId") UUID cursorId,
            Pageable pageable);
}
