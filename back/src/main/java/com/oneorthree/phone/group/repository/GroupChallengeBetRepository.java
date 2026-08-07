package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.MissionCategory;
import jakarta.persistence.LockModeType;
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

public interface GroupChallengeBetRepository extends JpaRepository<GroupChallengeBet, UUID> {

    /**
     * 개설 중복 사전 검사 — 같은 챌린지·같은 날짜의 <b>비취소</b> 내기 존재 여부. 호출측은 status 에
     * CANCELED 를 넘긴다: 취소는 "없던 일"이라 같은 날짜 재개설을 막지 않는다(GROMO-1201).
     * 레이스의 최후 방어선은 V28 부분 유니크 인덱스(비취소만 계수)다.
     */
    boolean existsByChallengeIdAndBetDateAndStatusNot(
            UUID challengeId, LocalDate betDate, GroupBetStatus status);

    /** 챌린지 삭제 가드 — 진행 중(OPEN) 내기가 걸려 있는 챌린지는 지울 수 없다. */
    boolean existsByChallengeIdAndStatus(UUID challengeId, GroupBetStatus status);

    /**
     * 참가·취소 진입점 — 내기 id 와 그룹 스코프를 함께 검증하며(남의 그룹 내기에 참가·취소 불가),
     * 행을 잠근다. 참가는 "OPEN 확인 → 참가 행 삽입 + 차감"의 check-then-act 라 잠금 없이는 취소
     * (명시적·탈퇴 자동)와 겹칠 때 방금 종료된 내기에 판돈이 묶일 수 있다 — 돈이 움직이는 경로는
     * 전부 같은 내기 행 잠금({@link #findByIdForUpdate})으로 직렬화한다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT b FROM GroupChallengeBet b WHERE b.id = :id AND b.group.id = :groupId")
    Optional<GroupChallengeBet> findByIdAndGroupIdForUpdate(
            @Param("id") UUID id,
            @Param("groupId") UUID groupId);

    /**
     * 내기 행 잠금 조회 — 참가자 목록을 읽고 돈을 움직이는 경로(정산·탈퇴 연동)의 직렬화 지점.
     *
     * <p>정산은 "참가자를 읽고 → 계산하고 → 지급"하는데, 그 사이에 탈퇴 연동이 참가 행을 지우고
     * 환불하면 정산의 낡은 스냅샷이 탈퇴자에게 지급까지 해 이중 지급이 된다. status CAS 는 상태
     * 전이만 잠글 뿐 <b>참가자 읽기</b>는 못 지키므로, 두 경로 모두 이 잠금 조회로 시작해 내기
     * 단위로 완전히 직렬화한다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT b FROM GroupChallengeBet b WHERE b.id = :id")
    Optional<GroupChallengeBet> findByIdForUpdate(@Param("id") UUID id);

    /**
     * 그룹 탈퇴 연동 대상 — 이 그룹에서 유저가 참가 중인 OPEN 내기 id. 실제 처리는 id 별로
     * {@link #findByIdForUpdate} 잠금 후 재검증한다(이 조회와 잠금 사이에 정산이 끝났을 수 있다).
     * id 오름차순 고정은 여러 내기를 잠글 때의 데드락 예방이다.
     */
    @Query("SELECT b.id FROM GroupChallengeBet b, GroupChallengeBetParticipant p "
            + "WHERE p.bet = b AND b.group.id = :groupId AND p.user.id = :userId "
            + "AND b.status = com.oneorthree.phone.group.domain.GroupBetStatus.OPEN ORDER BY b.id")
    List<UUID> findOpenBetIdsByGroupIdAndParticipantUserId(
            @Param("groupId") UUID groupId,
            @Param("userId") UUID userId);

    /**
     * 계정 탈퇴 연동 대상(GROMO-801) — 유저가 참가 중인 OPEN 내기 id 를 <b>그룹 무관 전수</b> 조회.
     * 멤버십을 경유하지 않는 이유: 강퇴(kick)는 참가 행·판돈을 정산용으로 남기므로,
     * is_left=true 라 활성 멤버십이 없는 유저도 OPEN 내기의 참가자일 수 있다.
     * id 오름차순은 전 그룹에 걸친 잠금 순서 고정(데드락 예방) — 위 그룹 스코프 조회와 같은 규율.
     */
    @Query("SELECT b.id FROM GroupChallengeBet b, GroupChallengeBetParticipant p "
            + "WHERE p.bet = b AND p.user.id = :userId "
            + "AND b.status = com.oneorthree.phone.group.domain.GroupBetStatus.OPEN ORDER BY b.id")
    List<UUID> findOpenBetIdsByParticipantUserId(@Param("userId") UUID userId);

    /**
     * 조회 조립용 — 챌린지 목록의 해당 날짜 내기를 IN 절 1회로 배치 로드한다(N+1 방지). 호출측은
     * status 에 CANCELED 를 넘겨 <b>취소만</b> 뺀다 — 취소는 "없던 일"이지만 정산 결과
     * (SETTLED·FORFEITED·REFUNDED)는 그날의 사실이라 계속 실려야 한다. 앱 결과 모달이 어제 날짜
     * 조회의 내기 존재 여부({@code hadBet})로 판정하므로 OPEN 으로 좁히면 안 된다(GROMO-1201).
     */
    List<GroupChallengeBet> findByChallengeIdInAndBetDateAndStatusNot(
            Collection<UUID> challengeIds, LocalDate betDate, GroupBetStatus status);

    /**
     * 휴면 배지(GROMO-1201) 판정용 — 주어진 챌린지 중 내기 이력이 한 번이라도 있는 챌린지 id 를
     * IN 절 1회로 배치 조회한다. status 무관(CANCELED 포함) — 기준이 "걸어 본 적 있음"이라, 정산
     * 3종만 보는 {@link #findLatestSettledByChallengeIds} 를 재사용하면 취소 이력만 있는 챌린지가
     * 이력 없음으로 오판된다.
     */
    @Query("SELECT DISTINCT b.challenge.id FROM GroupChallengeBet b WHERE b.challenge.id IN :challengeIds")
    List<UUID> findChallengeIdsWithAnyBet(@Param("challengeIds") Collection<UUID> challengeIds);

    /**
     * 조회 조립용 — 내일 폴백({@code GroupBetService.loadCurrentBets}, 계약 §3 응답 보수):
     * 오늘 내기가 없는 챌린지의 내일 OPEN 내기만 배치 로드한다. status 를 함께 거는 이유는
     * 취소된 내일 내기까지 카드에 세우지 않기 위해서다(취소는 "없던 일" — lastSettledBet 의
     * CANCELED 배제와 같은 규칙).
     */
    List<GroupChallengeBet> findByChallengeIdInAndBetDateAndStatus(
            Collection<UUID> challengeIds, LocalDate betDate, GroupBetStatus status);

    /**
     * 조회 조립용 — 챌린지별 <b>가장 최근 정산 내기 1건만</b> 배치 로드한다("지난 내기" 한 줄용).
     *
     * <p>Postgres {@code DISTINCT ON} 은 {@code ORDER BY} 선두 컬럼(challenge_id)마다 첫 행 하나만
     * 남긴다 — 그래서 결과는 챌린지 수만큼으로 고정된다. 전건을 끌어와 애플리케이션에서 추리면
     * 정산 이력이 쌓일수록(챌린지당 하루 1건) 그룹 상세 조회가 통째로 무거워진다.
     *
     * <p>V28 부분 유니크(비취소 내기는 챌린지당·날짜당 1개) 아래에서 CANCELED 는 같은 날짜에 공존할
     * 수 있지만, 이 쿼리는 정산 3종(비취소)만 허용하므로 챌린지·날짜당 최대 1행이다 — 동률이 없어
     * 선택은 항상 결정적이다. JPQL 로는 표현할 수 없어 네이티브 쿼리로 둔다.
     *
     * <p>status 는 정산 결과 3종만 허용 목록으로 명시한다 — {@code <> 'OPEN'} 이면 CANCELED(취소)가
     * "지난 내기"로 노출되는데, 구앱은 CANCELED 를 몰라 정산 결과처럼 오표시한다. 취소는 결과가
     * 아니라 없던 일이므로 이 줄에 나올 자격 자체가 없다.
     */
    @Query(value = "SELECT DISTINCT ON (b.challenge_id) b.* FROM group_challenge_bets b "
            + "WHERE b.challenge_id IN (:challengeIds) "
            + "AND b.status IN ('SETTLED', 'REFUNDED', 'FORFEITED') "
            + "ORDER BY b.challenge_id, b.bet_date DESC", nativeQuery = true)
    List<GroupChallengeBet> findLatestSettledByChallengeIds(
            @Param("challengeIds") Collection<UUID> challengeIds);

    /**
     * 종료 게이트 — {@code OPEN} 인 내기만 종료 상태로 <b>원자적으로</b> 전이시킨다(compare-and-set).
     * 정산(SETTLED/FORFEITED)뿐 아니라 취소(CANCELED — 명시적 취소·그룹 탈퇴 연동)도 같은 게이트를
     * 지난다 — 어느 경로든 전이에 성공한 트랜잭션 하나만 돈을 움직인다.
     *
     * <p>스케줄러(04:00)와 수동 트리거({@code POST /groups/bets/settle})가 겹쳐도 이 UPDATE 에
     * 성공한 트랜잭션 하나만 지급을 적용한다 — 뒤에 온 트랜잭션은 행 락에서 대기하다가 앞이 커밋되면
     * {@code status = OPEN} 조건이 깨져 0행을 돌려받고 스킵한다. 멱등키 유니크 제약은 이제
     * "우연한 방어선"이 아니라 최후 방어선으로만 남는다.
     *
     * <p>벌크 UPDATE 라 영속성 컨텍스트를 우회한다 — 호출 후 같은 트랜잭션에서 엔티티의
     * {@code status}/{@code settledAt} 을 읽지 말 것(값이 갱신 전 그대로다). {@code @UpdateTimestamp}
     * 도 타지 않으므로 {@code updatedAt} 을 함께 써 준다.
     *
     * @return 1 = 이 트랜잭션이 정산 권한을 가져갔다, 0 = 이미 다른 트랜잭션이 가져갔다(스킵)
     */
    @Modifying(flushAutomatically = true)
    @Query("UPDATE GroupChallengeBet b SET b.status = :settledStatus, b.settledAt = :settledAt, "
            + "b.updatedAt = :settledAt "
            + "WHERE b.id = :id AND b.status = com.oneorthree.phone.group.domain.GroupBetStatus.OPEN")
    int compareAndSetSettled(
            @Param("id") UUID id,
            @Param("settledStatus") GroupBetStatus settledStatus,
            @Param("settledAt") Instant settledAt);

    /** CAS 실패(0행) 시 "누가 어떤 상태로 끝냈는지" 를 엔티티 캐시 없이 다시 읽는다. */
    @Query("SELECT b.status FROM GroupChallengeBet b WHERE b.id = :id")
    Optional<GroupBetStatus> findStatusById(@Param("id") UUID id);

    /**
     * 일 배치 대상 — 어제까지의 미정산 내기 id. 엔티티가 아니라 id 만 뽑는 이유는 내기 단위로
     * 트랜잭션을 새로 열어 처리하기 때문이다(한 건 실패가 다른 건을 말아먹지 않게).
     */
    @Query("SELECT b.id FROM GroupChallengeBet b "
            + "WHERE b.status = :status AND b.betDate < :beforeDate ORDER BY b.betDate, b.id")
    List<UUID> findIdsByStatusAndBetDateBefore(
            @Param("status") GroupBetStatus status,
            @Param("beforeDate") LocalDate beforeDate);

    /**
     * 정산 결과 푸시(B4) 대상 — 최근 정산이 끝난 내기. 상태는 호출측이 (SETTLED, FORFEITED) 로 넘긴다
     * (CANCELED 는 결과가 아니라 없던 일이라 발송 대상이 아니다).
     *
     * <p>"직전 발송 이후" 를 상태로 들고 있지 않고 최근 구간을 통째로 다시 훑는 이유는, 발송 여부의
     * 단일 소스가 {@code NotificationSentLog} dedup 이기 때문이다 — 08:00·13:00 두 크론이 겹쳐 돌아도
     * 이미 보낸 건은 dedup 에서 빠지고, 앞선 실행에서 발송이 실패한 건은 다음 실행이 자연히 재시도한다.
     *
     * <p>group·challenge 를 함께 fetch 한다 — 딥링크에 groupId 가 필요해 건마다 프록시를 깨우면
     * 정산 건수만큼 SELECT 가 더 나간다.
     */
    @Query("SELECT b FROM GroupChallengeBet b JOIN FETCH b.group JOIN FETCH b.challenge "
            + "WHERE b.status IN :statuses AND b.settledAt >= :since ORDER BY b.settledAt, b.id")
    List<GroupChallengeBet> findByStatusInAndSettledAtSince(
            @Param("statuses") Collection<GroupBetStatus> statuses,
            @Param("since") Instant since);

    /**
     * 카테고리별 일 배치 대상 — 정산 크론이 2회(FOCUS 01:00 · SCREEN_TIME 12:00)로 나뉘어 돌기 때문에
     * 대상 선정도 챌린지 카테고리로 갈라야 한다. 스크린타임 내기를 01:00 에 집으면 "어제 마감 보고가
     * 아침 첫 앱 실행에 올라온다"는 전제가 깨져 미보고=미달성 패배가 양산된다.
     */
    @Query("SELECT b.id FROM GroupChallengeBet b JOIN b.challenge c "
            + "WHERE b.status = :status AND b.betDate < :beforeDate AND c.category = :category "
            + "ORDER BY b.betDate, b.id")
    List<UUID> findIdsByStatusAndBetDateBeforeAndCategory(
            @Param("status") GroupBetStatus status,
            @Param("beforeDate") LocalDate beforeDate,
            @Param("category") MissionCategory category);
}
