package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetParticipant;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
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
 * 회차 참가 행 — "누가 이 판에 돈을 걸었나"의 단일 소스. 참가 취소·탈퇴는 마킹이 아니라 <b>행 삭제</b>라
 * 존재 자체가 참가 여부이고, 그래서 잠금 대기 뒤의 재조회가 empty 인 것이 정상 경로일 수 있다
 * (1258 P0 이중 환불 방지).
 *
 * <p>조회 축이 <b>참가자 스코프</b>다 — 그룹 멤버십을 경유하지 않는다. 시작된 회차의 참가는 그룹을
 * 나가도 정산 대상으로 남기 때문에(C8·N19), 그룹 축으로 찾으면 그 회차를 영영 놓친다.
 *
 * <p>뒤쪽 네 메서드는 <b>결과 표시 선점(lease)</b> 체계다(GROMO-1577 · B17): 잠금 → 조건부 UPDATE 로
 * 선점 → 렌더 직전 재검증·연장 → 확인(ack). 시각은 전부 <b>DB 시계</b>({@code clock_timestamp()})로
 * 찍고 비교한다 — 인스턴스마다 다른 {@code Instant.now()} 를 섞으면 시계가 빠른 쪽이 남의 살아 있는
 * 선점을 만료로 보고 회수해 두 기기가 같은 결과를 함께 띄운다.
 *
 * <p><b>{@code @Modifying} 메서드는 트랜잭션을 열지 않는다.</b> 호출측이 {@code @Transactional}
 * 안에 있는지 확인할 책임을 진다 — 없으면 {@code InvalidDataAccessApiUsageException} 이 난다
 * (GROMO-1655, 규약 §4). 이 저장소의 유일한 예외는
 * {@code GroupChallengeBetSessionRepository#recordFailure} 로, 무트랜잭션 스케줄러가 직접 부른다.
 */
public interface GroupChallengeBetParticipantRepository
        extends JpaRepository<GroupChallengeBetParticipant, UUID> {

    /**
     * 이 회차에 이미 참가했는지 — 중복 참가 사전 검사.
     *
     * @param sessionId 참가하려는 회차
     * @param userId 참가하려는 유저
     * @return 참가 행이 있으면 true. 락이 없으므로 <b>이 검사만으로 중복 참가를 막지 못한다</b> —
     *     실제 방어는 회차 행 잠금과 원장 유니크가 진다
     */
    boolean existsBySessionIdAndUserId(UUID sessionId, UUID userId);

    /**
     * 참가 시각(GROMO-1407 후속 — 지연 선기록 차단의 비교축). 참가 행 {@code created_at} 은
     * 참가비 차감과 같은 트랜잭션에서 박제되므로 "언제부터 돈이 걸렸나"의 단일 진실이다.
     *
     * <p>존재 판정({@code existsBySessionIdAndUserId})을 겸한다 — 값이 있으면 참가자다. 두 번 묻지
     * 않으려고 스칼라 하나만 뽑는다(보고는 저지연 경로라 엔티티·연관 fetch 를 피한다).
     *
     * @param sessionId 보고가 귀속될 회차
     * @param userId 보고한 유저
     * @return 참가비가 빠져나간 시각. 이 시각보다 이른 측정 보고는 "참가 전 기록"이라 인정하지 않는다.
     *     <b>empty 는 곧 미참가</b>다(존재 판정을 겸한다)
     */
    @Query("SELECT p.createdAt FROM GroupChallengeBetParticipant p "
            + "WHERE p.session.id = :sessionId AND p.user.id = :userId")
    Optional<Instant> findJoinedAtBySessionIdAndUserId(@Param("sessionId") UUID sessionId,
                                                       @Param("userId") UUID userId);

    /**
     * 회차 참가 인원.
     *
     * @param sessionId 세어 볼 회차
     * @return 참가 행 수. <b>0 은 "아무도 안 걸었다"</b>이고, 이 경우 회차는 결과가 아니라
     *     {@code UNUSED} 로 접힌다(N52). 참가 취소가 행을 지우므로 이 값은 줄어들 수 있다
     */
    long countBySessionId(UUID sessionId);

    /**
     * 조기 확정 대상(GROMO-1268, N11) — 유저가 참가 중인 그 날짜의 <b>FOCUS</b> OPEN 회차에서 아직
     * 미확정({@code achieved IS NULL})인 참가 행의 <b>식별자만</b>. 미션 스냅샷의 카테고리로
     * 거르므로(SCREEN_TIME 은 조기 확정 자체가 성립하지 않는다 — FR-23) 챌린지 조인이 없다.
     * 회차 id 오름차순 — 호출측이 이 순서로 <b>전부 잠근 뒤</b> 판정한다(탈퇴 연동 등 오름차순
     * 경로와의 교차 데드락 방지, §5.4).
     *
     * <p><b>엔티티가 아니라 id 를 돌려주는 것이 계약이다.</b> 엔티티로 받으면 대상 참가 행이
     * 영속성 컨텍스트(1차 캐시)에 올라가고, 회차 락을 기다리는 동안 취소·탈퇴가 그 행을 지워도
     * 이후 {@code findById} 가 DB 를 보지 않고 <b>캐시된 유령 엔티티</b>를 돌려준다. 그 유령을
     * 수정하면 flush 가 0건 UPDATE 로 터져 집중 세션 저장·통계·보상 트랜잭션 전체가 롤백된다
     * (남의 취소 때문에 내 집중 기록이 사라진다). id 만 받으면 잠금 후 첫 로드가 실제 DB 읽기라
     * 삭제가 그대로 보인다.
     *
     * @param userId 집중 세션을 막 끝낸 유저
     * @param dates 확정 후보 회차일들 — 세션이 자정을 걸칠 수 있어 복수다(KST 회차일 기준)
     * @return 회차 id 오름차순 (참가 행 id, 회차 id) 쌍. <b>엔티티가 아니라 id 인 것이 계약</b>이며,
     *     빈 리스트면 지금 확정할 대상이 없다는 뜻이다. 이 순서 그대로 전부 잠근 뒤 판정해야
     *     탈퇴 연동 경로와 교차 데드락이 나지 않는다
     */
    @Query("SELECT p.id AS participantId, p.session.id AS sessionId "
            + "FROM GroupChallengeBetParticipant p JOIN p.session s "
            + "WHERE p.user.id = :userId AND p.achieved IS NULL "
            + "AND s.status = com.oneorthree.phone.group.repository.domain.GroupBetStatus.OPEN "
            + "AND s.sessionDate IN :dates "
            + "AND s.missionCategory = com.oneorthree.phone.group.repository.domain.MissionCategory.FOCUS "
            + "ORDER BY s.id")
    List<UnconfirmedFocusTarget> findUnconfirmedOpenFocusTargetsByUserAndDates(
            @Param("userId") UUID userId,
            @Param("dates") Collection<LocalDate> dates);

    /** {@link #findUnconfirmedOpenFocusTargetsByUserAndDates} 프로젝션 — 참가 행 · 그 회차. */
    interface UnconfirmedFocusTarget {
        /** @return 확정 대상 참가 행 id — 회차 락을 잡은 뒤 이 id 로 <b>다시 로드</b>해야 삭제가 보인다. */
        UUID getParticipantId();

        /** @return 그 참가가 걸린 회차 id — 잠금 대상이자 정렬 키다(오름차순 잠금 규약). */
        UUID getSessionId();
    }

    /**
     * 조기 정산 전원 확정 검사(GROMO-1268) — 미확정({@code achieved IS NULL}) 참가자 수.
     * {@code AFTER_COMMIT} 리스너가 커밋된 상태 기준으로 세고, 최종 판정은 {@code settle(EARLY)}
     * 가 회차 락 안에서 다시 한다(리스너의 무락 검사는 낡았을 수 있다 — LLD §5.2).
     *
     * @param sessionId 조기 정산 후보 회차
     * @return 아직 승리가 확정되지 않은 참가자 수. <b>0 이면 전원 확정</b>이라 조기 정산 조건이 선다.
     *     락 없이 세므로 이 값은 힌트일 뿐이고, 최종 판정은 회차 락 안에서 다시 한다
     */
    @Query("SELECT COUNT(p) FROM GroupChallengeBetParticipant p "
            + "WHERE p.session.id = :sessionId AND p.achieved IS NULL")
    long countBySessionIdAndAchievedIsNull(@Param("sessionId") UUID sessionId);

    /**
     * 잠금 후 재조회용 단건 — 회차 행 잠금을 잡은 <b>뒤</b> 내 참가 행이 아직 있는지 다시 본다
     * (1258 P0 이중 환불 재발 방지: 잠금 대기 중 취소·탈퇴가 이미 처리했으면 없어야 정상).
     *
     * @param sessionId 잠금을 잡은 회차
     * @param userId 확인할 참가자
     * @return 아직 살아 있는 참가 행(유저 함께 로드). <b>empty 가 정상 경로</b>일 수 있다 — 잠금을
     *     기다리는 사이 취소·탈퇴가 이미 환불을 마쳤다는 뜻이므로 여기서 또 환불하면 이중 지급이다
     */
    @EntityGraph(attributePaths = "user")
    Optional<GroupChallengeBetParticipant> findBySessionIdAndUserId(UUID sessionId, UUID userId);

    /**
     * 조회 조립·정산 공용 배치 로드. 응답에 닉네임이 필요하고 정산도 userId 를 봐야 하므로
     * user 를 함께 fetch 해 참가자 수만큼의 추가 SELECT 를 막는다.
     *
     * @param sessionIds 참가자를 붙일 회차 id 들. 빈 컬렉션이면 빈 결과다
     * @return 여러 회차의 참가 행이 <b>한 리스트에 섞여</b> 온다(유저 함께 로드) — 호출측이 회차 id 로
     *     접어 쓴다. 정렬이 없고, 참가자가 없는 회차는 아예 빠진다(결손 = 0명)
     */
    @EntityGraph(attributePaths = "user")
    List<GroupChallengeBetParticipant> findBySessionIdIn(Collection<UUID> sessionIds);

    /**
     * 내 OPEN 회차(GROMO-1415, N43 보고 대상 탐색축) — <b>참가자 스코프, 그룹 무관</b>. 그룹
     * 멤버십을 경유하지 않는 이유: 탈퇴·강퇴 후에도 시작된 회차의 참가는 정산 대상으로 남는데
     * (C8·N19), 그룹 목록 축으로는 그 회차를 영영 못 찾는다. 회차 스냅샷(창 시각·목표)을 응답에
     * 실어야 하므로 session 을 함께 fetch 한다.
     *
     * @param userId 보고 대상을 찾는 유저
     * @return 회차일·회차 id 오름차순의 내 OPEN 참가 전량(회차 스냅샷 함께 로드). <b>그룹을 나갔어도
     *     실린다</b> — 시작된 회차의 참가는 정산 대상으로 남기 때문이다(C8·N19). 빈 리스트면 지금
     *     보고를 받을 회차가 없다는 뜻이다
     */
    @Query("SELECT p FROM GroupChallengeBetParticipant p JOIN FETCH p.session s "
            + "WHERE p.user.id = :userId "
            + "AND s.status = com.oneorthree.phone.group.repository.domain.GroupBetStatus.OPEN "
            + "ORDER BY s.sessionDate, s.id")
    List<GroupChallengeBetParticipant> findOpenSessionParticipationsByUserId(@Param("userId") UUID userId);

    /**
     * 선점·확인 실패 사유 판정용 <b>스냅샷</b>(GROMO-1577) — 조건부 UPDATE 가 0행을 돌려줬을 때
     * 그 이유를 가르는 읽기다. 엔티티 대신 스칼라만 뽑는 이유: 회차 상태를 보려고 엔티티를 읽으면
     * {@code session} 이 지연 프록시라 트랜잭션 밖 호출에서 터진다. 조인 하나로 한 번에 읽는다.
     *
     * <p><b>남은 리스도 DB 가 계산한다</b> — 인스턴스의 시계를 섞지 않는다. 애플리케이션에서
     * {@code claimedAt + 리스 − Instant.now()} 를 하면 선점 시각은 DB 시계인데 빼는 값은 그 인스턴스의
     * 시계라, 시계가 어긋난 인스턴스가 계산하면 지연이 음수(즉시 재시도)나 과대(한참 안 띄움)로 나온다.
     * 상한·하한도 SQL 에서 건다({@code display_claimed_at} 이 비어 있으면 0 — 지금 바로 다시 시도해도
     * 좋다는 뜻이다).
     *
     * @param sessionId 실패한 선점·확인이 겨눴던 회차
     * @param userId 그 요청을 낸 유저
     * @param leaseSeconds 리스 수명(초) — 남은 지연의 상한이자 계산 기준이다. 값이 실제 리스와 다르면
     *     앱이 안내받는 재시도 시각이 어긋난다
     * @return 사유 판정에 필요한 스칼라 묶음. <b>empty 는 "그 회차의 내 참가 행이 없다"</b>는 뜻이라
     *     그 자체가 하나의 실패 사유다
     */
    @Query(value = "SELECT p.acknowledged_at AS \"acknowledgedAt\", s.status AS \"sessionStatus\", "
            + "c.deleted_at AS \"challengeDeletedAt\", "
            + "CASE WHEN p.display_claimed_at IS NULL THEN 0 ELSE "
            + "GREATEST(0, LEAST(:leaseSeconds * 1000, CAST(EXTRACT(EPOCH FROM "
            + "(p.display_claimed_at + make_interval(secs => :leaseSeconds) - clock_timestamp())) "
            + "* 1000 AS bigint))) "
            + "END AS \"retryAfterMs\" "
            + "FROM group_challenge_bet_participants p "
            + "JOIN group_challenge_bet_sessions s ON s.id = p.session_id "
            + "JOIN group_challenges c ON c.id = s.challenge_id "
            + "WHERE p.session_id = :sessionId AND p.user_id = :userId", nativeQuery = true)
    Optional<ClaimStateView> findClaimStateBySessionIdAndUserId(
            @Param("sessionId") UUID sessionId,
            @Param("userId") UUID userId,
            @Param("leaseSeconds") long leaseSeconds);

    /**
     * {@link #findClaimStateBySessionIdAndUserId} 프로젝션 — 확인 시각 · 회차 상태 · <b>DB 가 계산한</b>
     * 남은 리스(밀리초, 상대 지연).
     */
    interface ClaimStateView {
        /** @return 이미 확인했으면 그 시각, 아직이면 null — 값이 있으면 재시도해도 소용없다. */
        Instant getAcknowledgedAt();

        /**
         * @return 회차 상태 <b>이름</b>(네이티브 쿼리라 enum 이 아니라 문자열이다). 결과 4종이 아니면
         *     "아직 결과가 아니어서" 실패한 것이다
         */
        String getSessionStatus();

        /**
         * 챌린지 소프트 삭제 시각 — 값이 있으면 이 결과는 큐에 있어서는 안 된다(N48·FR-44-4).
         *
         * @return 삭제됐으면 그 시각, 아니면 null. 값이 있는데 선점이 0행이었다면 그것이 실패 사유다
         */
        Instant getChallengeDeletedAt();

        /**
         * @return 남은 리스(밀리초) — <b>DB 가 계산한 상대 지연</b>이다(절대 시각을 응답에 싣지 않는다).
         *     0 은 "지금 바로 다시 시도해도 좋다"는 뜻이고, 리스 수명이 상한이라 그보다 크게 나오지 않는다
         */
        long getRetryAfterMs();
    }

    /**
     * 선점 대상 참가 행을 <b>먼저 잠근다</b>(GROMO-1577) — 조건부 UPDATE 바로 앞에 둔다.
     *
     * <p><b>{@code clock_timestamp()} 만으로는 부족하다.</b> Postgres 는 UPDATE 의 {@code SET} 식을
     * <b>행 잠금을 기다리기 전에</b> 계산한다(대기는 그 뒤 {@code heap_update} 안에서 일어나고, 단순
     * 잠금 대기는 EvalPlanQual 재계산을 부르지 않는다). 그래서 잠금을 1초 기다린 선점은 리스가
     * <b>1초 과거로</b> 찍힌다 — 실측으로 확인했다(스탬프가 잠금 해제 시각보다 정확히 대기 시간만큼
     * 이르다). 그러면 남이 그만큼 일찍 만료로 보고 회수해 두 기기가 함께 렌더한다.
     *
     * <p>잠금을 먼저 잡으면 이어지는 UPDATE 는 더 기다릴 것이 없어 {@code clock_timestamp()} 가 곧
     * "지금"이다. 같은 트랜잭션 안에서 잠금을 쥔 채 CAS 하므로 원자성도 오히려 더 분명해진다
     * (호출측 서비스 메서드가 {@code @Transactional} 이라 두 문장이 한 트랜잭션이다).
     *
     * <p>ack 에는 이 잠금을 두지 않는다 — {@code acknowledged_at} 은 <b>기록</b>이지 만료 판정의
     * 기준축이 아니라, 몇 밀리초 이르게 찍혀도 아무것도 깨지지 않는다.
     *
     * @param sessionId 선점하려는 결과의 회차
     * @param userId 선점을 요청한 유저
     * @return 잠근 참가 행 id — 비어 있으면 그 회차의 내 참가 행이 없다(후속 UPDATE 도 0행).
     *     다른 트랜잭션이 같은 행을 쥐고 있으면 <b>대기</b>한다(건너뛰지 않는다)
     */
    @Query(value = "SELECT p.id FROM group_challenge_bet_participants p "
            + "WHERE p.session_id = :sessionId AND p.user_id = :userId FOR UPDATE", nativeQuery = true)
    Optional<UUID> lockForDisplayClaim(
            @Param("sessionId") UUID sessionId,
            @Param("userId") UUID userId);

    /**
     * 결과 표시 <b>선점</b>(lease) 획득·회수 — 조건부 원자 UPDATE 하나로 "비어 있음"과 "만료된 남의
     * 선점 회수"를 함께 집는다(GROMO-1577 · B17). 알림 클레임의
     * {@code NotificationSentLogRepository.reclaimExpired} 와 같은 모양이다.
     *
     * <p><b>{@code acknowledged_at IS NULL} 이 같은 UPDATE 조건에 들어 있는 것이 핵심이다.</b>
     * 두 기기가 함께 {@code acknowledged=false} 를 조회한 뒤 A 가 {@code claim → 노출 → ack} 를
     * 끝내도, B 의 메모리에는 미확인 DTO 가 남아 나중에 claim 을 부를 수 있다. 여기서 ack 여부를
     * 보지 않으면 B 가 <b>유효한 새 선점</b>을 받아 같은 결과를 다시 렌더한다 — IA §4.3 이 수용한
     * 것은 ack 가 <b>실패</b>했을 때의 좁은 창이지 성공한 뒤의 중복이 아니다.
     *
     * <p><b>회차가 이미 결과인 것도 같은 조건에 넣는다</b>({@code statuses} = 결과 4종). 앱은
     * {@code /me/bet-sessions} 로 <b>OPEN 회차 id</b> 도 들고 있어서, 이 조건이 없으면 정산 전 회차에
     * 선점·확인이 찍히고 그 회차가 나중에 정산됐을 때 처음부터 확인된 것으로 조회돼 <b>어느
     * 기기에서도 안 뜬다</b> — V49 백필을 결과 4종으로 좁힌 것과 같은 사고를 런타임에서 막는다.
     *
     * <p><b>삭제된 챌린지의 회차도 같은 조건에서 막는다</b>({@code c.deleted_at IS NULL}) — 조회는
     * 이미 삭제 회차를 빼는데(N48·FR-44-4: 삭제 환불은 {@code BET_VOID_REFUND} 푸시가 알리므로
     * 모달까지 열면 이중 통지) 선점이 상태만 보면, 결과를 받아 둔 앱이 <b>모달을 띄우기 전에 삭제된</b>
     * 챌린지의 결과를 캐시된 sessionId 로 선점해 그대로 노출한다. 삭제해도 기존 정산 회차는 남으므로
     * 실제로 성립하는 경합이다.
     *
     * <p><b>리스의 시계는 DB 다</b> — 기록도 만료 비교도 한 시계에서 한다. 각 인스턴스의
     * {@code Instant.now()} 로 찍고 비교하면, 시계가 빠른 인스턴스가 느린 인스턴스의 <b>방금 만든
     * 선점을 이미 만료로 보고 즉시 회수</b>한다. 그러면 렌더 직전 재검증을 통과한 뒤에도 다른 기기가
     * 재선점해 중복 노출이 난다 — ShedLock 이 {@code usingDbTime()} 을 쓰는 것과 같은 이유다
     * ("인스턴스 간 시계가 어긋나면 락이 조기 만료되거나 영원히 잡혀 있는 것처럼 보인다").
     * 그래서 이 세 UPDATE 는 <b>네이티브</b>다 — JPQL 로는 DB 함수와 interval 연산을 표현할 수 없다.
     *
     * <p>⚠️ <b>{@code now()} 가 아니라 {@code clock_timestamp()} 다.</b> Postgres 의 {@code now()} 는
     * {@code transaction_timestamp()} 라 <b>트랜잭션 시작 시각으로 고정</b>된다 — 참가 행 잠금을 기다린
     * 뒤 이 UPDATE 가 돌면 선점이 <b>대기한 시간만큼 과거로</b> 찍히고 만료 비교도 낡은 시각으로 한다.
     * 대기가 리스(2분)에 근접하면 재검증에 성공한 직후에도 남이 만료로 보고 회수해 두 기기가 함께
     * 렌더한다. {@code clock_timestamp()} 는 <b>실행 순간</b>의 벽시각이라 그 창이 없다.
     * (같은 함정의 애플리케이션 판이 이 클래스 이전 판의 {@code Instant.now()} 였다.)
     *
     * <p>⚠️ <b>V49 마이그레이션의 {@code now()} 는 그대로 두는 것이 맞다</b> — 거기서는 세 문장이
     * <b>같은 값</b>(마이그레이션 시작 시각)을 봐야 백필·tombstone·종결의 술어가 갈리지 않는다.
     * 두 곳의 선택은 <b>서로 다른 이유로 각각 옳다</b> — 한쪽에 맞춰 통일하면 다른 쪽이 깨진다.
     *
     * @param sessionId    표시를 선점할 결과의 회차
     * @param userId        선점을 요청한 유저 — 남의 참가 행은 건드리지 않는다
     * @param token        이번 선점에 발급하는 새 토큰. 앱이 렌더 직전 재검증·ack 에 이 값을 되돌려준다
     * @param leaseSeconds 리스 수명(초) — 만료 컷오프는 {@code now() − leaseSeconds} 로 <b>DB 가</b> 뺀다
     * @param statuses     결과로 치는 회차 상태 이름
     *                     ({@link GroupBetStatus#RESULT_STATUS_NAMES})
     * @return 1 = 이 호출이 표시를 선점했다, 0 = 이미 확인됨 · 남의 리스가 살아 있음 · 아직 결과가
     *     아님 · 대상 행 없음 (구분은 호출측이 행을 다시 읽어 판정한다)
     */
    // 트랜잭션은 걸지 않는다 — 유일한 호출부 ChallengeResultAckService.claimDisplay 가 @Transactional 이라
    // 이 UPDATE 는 그 경계 안에서 돈다. 붙여 봐야 기본 전파가 REQUIRED 라 그 트랜잭션에 합류할 뿐이고,
    // 리포지토리가 경계를 소유하는 것처럼 읽히는 장식만 남는다(GROMO-1655).
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = "UPDATE group_challenge_bet_participants p "
            + "SET display_claimed_at = clock_timestamp(), display_claim_token = :token "
            + "WHERE p.session_id = :sessionId AND p.user_id = :userId "
            + "AND p.acknowledged_at IS NULL "
            + "AND (p.display_claimed_at IS NULL "
            + "OR p.display_claimed_at < clock_timestamp() - make_interval(secs => :leaseSeconds)) "
            + "AND EXISTS (SELECT 1 FROM group_challenge_bet_sessions s "
            + "JOIN group_challenges c ON c.id = s.challenge_id "
            + "WHERE s.id = p.session_id AND s.status IN (:statuses) "
            + "AND c.deleted_at IS NULL)", nativeQuery = true)
    int claimDisplay(
            @Param("sessionId") UUID sessionId,
            @Param("userId") UUID userId,
            @Param("token") UUID token,
            @Param("leaseSeconds") long leaseSeconds,
            @Param("statuses") Collection<String> statuses);

    /**
     * 결과 표시 선점 <b>재검증 + 리스 연장</b> — 렌더 직전에 "내 선점이 아직 내 것인가"를 묻고
     * <b>같은 쓰기 하나로</b> 리스를 렌더·ack 구간까지 밀어 둔다(GROMO-1577 · B17 · IA §4.3).
     *
     * <p><b>검증과 연장이 두 번의 쓰기로 갈리면 안 된다.</b> 검증 응답을 받은 뒤 실제 모달이
     * 마운트되기까지도 시간이 있어, 그 사이 앱이 잠시 멈추면 리스가 만료되고 다른 기기가 재선점한다
     * — 검증만으로는 TOCTOU 가 그대로 남는다.
     *
     * <p><b>소유 판정은 토큰 일치 하나다</b>(만료 여부를 보지 않는다). 리스가 만료됐어도 <b>아무도
     * 가져가지 않았다면</b> 토큰은 여전히 내 것이라 그대로 이어 쓰는 게 맞고, 남이 회수했다면 그
     * 순간 토큰이 새로 발급돼 <b>불일치</b>로 걸린다 — 만료 시각을 따로 보면 "만료됐지만 아무도 안
     * 가져간" 정상 복귀를 이유 없이 거절한다.
     *
     * <p><b>토큰은 회전시키지 않는다.</b> 회전시키면 갱신 응답이 네트워크에서 유실됐을 때 앱이 든
     * 토큰이 영구히 낡은 값이 되어 ack 까지 막힌다(그 회차는 리스가 만료될 때까지 어느 경로로도
     * 회복하지 못한다). 같은 값을 유지하면 갱신 재시도가 그대로 멱등이다.
     *
     * <p>삭제 가드({@code c.deleted_at IS NULL})가 <b>여기에도</b> 있다 — 재검증은 "지금 띄워도 되나"를
     * 묻는 마지막 관문이라, 선점과 노출 사이에 챌린지가 삭제되면 그 결과는 뜨면 안 된다(N48).
     *
     * @param sessionId 렌더하려는 결과의 회차
     * @param userId 렌더를 시도하는 유저
     * @param token 선점 때 받은 토큰 — 소유 판정의 <b>유일한</b> 근거다(만료 시각은 보지 않는다).
     *     회전시키지 않으므로 응답이 유실돼도 같은 값으로 재시도하면 멱등이다
     * @param statuses 결과로 치는 회차 상태 이름({@link GroupBetStatus#RESULT_STATUS_NAMES})
     * @return 1 = 내 선점이 유효하고 리스를 연장했다, 0 = 이미 확인됨 · 남이 재선점함 · 아직 결과가
     *     아님 · 챌린지가 삭제됨 · 대상 행 없음
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = "UPDATE group_challenge_bet_participants p "
            + "SET display_claimed_at = clock_timestamp() "
            + "WHERE p.session_id = :sessionId AND p.user_id = :userId "
            + "AND p.acknowledged_at IS NULL "
            + "AND p.display_claim_token = :token "
            + "AND EXISTS (SELECT 1 FROM group_challenge_bet_sessions s "
            + "JOIN group_challenges c ON c.id = s.challenge_id "
            + "WHERE s.id = p.session_id AND s.status IN (:statuses) "
            + "AND c.deleted_at IS NULL)", nativeQuery = true)
    int renewDisplayClaim(
            @Param("sessionId") UUID sessionId,
            @Param("userId") UUID userId,
            @Param("token") UUID token,
            @Param("statuses") Collection<String> statuses);

    /**
     * 결과 확인 표시(ack) — {@code acknowledged_at IS NULL} 조건부 원자 UPDATE 라 중복·동시 호출에도
     * 최초 1회만 세팅된다(리그 {@code LeagueWeeklyResultRepository.acknowledge} 선례, GROMO-1577).
     *
     * <p><b>선점을 함께 종결</b>한다({@code display_claimed_at}·{@code display_claim_token} 을
     * 비운다) — 남겨 두면 만료된 lease 가 계속 판정 대상으로 남는다. 반대로 <b>토큰이 일치할 때만</b>
     * 성사시키는 이유는, 내 선점이 만료돼 다른 기기가 재선점한 뒤 깨어난 기기가 자기가 띄우지도
     * 못한 결과를 확인 처리해 버리는 것을 막기 위해서다(IA §4.3 TOCTOU).
     *
     * <p>선점과 마찬가지로 <b>회차가 이미 결과일 때만</b> 성사된다 — 정산 전 회차에 확인 표시가
     * 찍히면 그 회차의 결과를 어느 기기에서도 못 본다.
     *
     * <p><b>삭제 가드는 여기에만 없다</b>(의도된 비대칭). ack 은 "띄워도 되나"가 아니라 <b>이미 본
     * 것을 기록</b>하는 연산이다 — 모달이 떠 있는 사이에 챌린지가 삭제됐다고 확인 표시를 거절하면,
     * 사용자는 분명히 봤는데 {@code acknowledged_at} 이 영영 비고 선점만 리스 만료까지 남는다.
     * 삭제 회차는 조회에서 이미 빠지므로(N48) 확인을 기록해도 다시 뜨지 않는다. 토큰은 삭제 전
     * 선점에서만 얻을 수 있어 이 경로로 새로 노출되는 것도 없다.
     *
     * @param sessionId 확인 처리할 결과의 회차
     * @param userId 결과를 본 유저
     * @param token 선점 때 받은 토큰 — 일치할 때만 성사된다(남이 재선점했으면 불일치로 걸린다)
     * @param statuses 결과로 치는 회차 상태 이름({@link GroupBetStatus#RESULT_STATUS_NAMES})
     * @return 1 = 이 호출이 확인 처리했다, 0 = 대상 행 없음 · 이미 확인됨 · 토큰 불일치 · 아직 결과가 아님
     */
    // flushAutomatically 도 함께 켠다(GROMO-801 예방) — 리그 acknowledge 와 같은 이유.
    // 확인 시각도 선점과 같은 시계(DB)로 찍는다 — 두 값이 다른 시계면 "선점보다 이른 확인" 같은
    // 뒤집힌 이력이 남는다.
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = "UPDATE group_challenge_bet_participants p "
            + "SET acknowledged_at = clock_timestamp(), "
            + "display_claimed_at = NULL, display_claim_token = NULL "
            + "WHERE p.session_id = :sessionId AND p.user_id = :userId "
            + "AND p.acknowledged_at IS NULL "
            + "AND p.display_claim_token = :token "
            // 삭제 가드 없음(의도) — 위 javadoc 참조. group_challenges 조인도 그래서 없다.
            + "AND EXISTS (SELECT 1 FROM group_challenge_bet_sessions s "
            + "WHERE s.id = p.session_id AND s.status IN (:statuses))", nativeQuery = true)
    int acknowledge(
            @Param("sessionId") UUID sessionId,
            @Param("userId") UUID userId,
            @Param("token") UUID token,
            @Param("statuses") Collection<String> statuses);

    /**
     * 내 <b>미확인</b> 정산 완료 회차(GROMO-1415, N53 결과 모달 큐의 단일 소스) — 참가자 스코프.
     * 멤버십·챌린지 ACTIVE 를 보지 않아 탈퇴자·종료 챌린지 회차도 실린다. 단 <b>삭제된 챌린지의
     * 회차는 제외</b>(FR-44-4·N48 — 삭제 환불은 BET_VOID_REFUND 푸시가 알리므로 모달까지 띄우면
     * 이중 통지), UNUSED 는 statuses 에서 이미 빠져 있다(N52). since 는 settled_at 하한(최근 30일
     * 바닥은 호출측이 보정). 응답 조립에 그룹 이름·챌린지 상태가 필요해 함께 fetch 한다.
     *
     * <p><b>{@code acknowledged_at IS NULL} 이 페이지 상한보다 <u>먼저</u> 걸리는 것이 계약이다</b>
     * (GROMO-1577). 확인된 행까지 실어 놓고 앱이 거르면, 최근 30일에 결과가 11건 이상인 사용자는
     * 확인된 10건이 상한을 통째로 점유해 <b>11번째 미확인 결과가 영영 조회되지 않는다</b> — 상한이
     * ack 보다 먼저 걸리는 데드락이다. {@code since} 는 하한({@code >=})이지 이전 페이지를 가져오는
     * 커서가 아니라서 그 자리를 메우지 못한다.
     *
     * @param userId 결과 큐를 볼 유저
     * @param statuses 결과로 치는 회차 상태 4종 — {@code UNUSED}(0명 종료)는 결과가 아니라 빠져 있다(N52)
     * @param since {@code settledAt} 하한(포함). <b>커서가 아니라 하한</b>이라 이보다 오래된 결과는
     *     페이지를 넘겨도 나오지 않는다
     * @param pageable 페이지 상한 — ack 필터가 <b>상한보다 먼저</b> 걸리므로 확인된 결과가 자리를
     *     차지하지 않는다
     * @return 회차일 내림차순 미확인 결과 참가 행(회차·그룹·챌린지 함께 로드). 그룹을 나갔거나
     *     챌린지가 종료됐어도 실리지만 <b>삭제된 챌린지의 회차는 빠진다</b>. 빈 리스트면 띄울 결과
     *     모달이 없다는 뜻이다
     */
    @Query("SELECT p FROM GroupChallengeBetParticipant p "
            + "JOIN FETCH p.session s JOIN FETCH s.group JOIN FETCH s.challenge c "
            + "WHERE p.user.id = :userId AND s.status IN :statuses "
            + "AND p.acknowledgedAt IS NULL "
            + "AND c.deletedAt IS NULL AND s.settledAt >= :since "
            + "ORDER BY s.sessionDate DESC, s.id DESC")
    List<GroupChallengeBetParticipant> findSettledParticipationsByUserId(
            @Param("userId") UUID userId,
            @Param("statuses") Collection<GroupBetStatus> statuses,
            @Param("since") Instant since,
            Pageable pageable);
}
