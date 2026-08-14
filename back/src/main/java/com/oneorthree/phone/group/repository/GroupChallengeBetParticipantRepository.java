package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
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

public interface GroupChallengeBetParticipantRepository
        extends JpaRepository<GroupChallengeBetParticipant, UUID> {

    boolean existsBySessionIdAndUserId(UUID sessionId, UUID userId);

    /**
     * 참가 시각(GROMO-1407 후속 — 지연 선기록 차단의 비교축). 참가 행 {@code created_at} 은
     * 참가비 차감과 같은 트랜잭션에서 박제되므로 "언제부터 돈이 걸렸나"의 단일 진실이다.
     *
     * <p>존재 판정({@code existsBySessionIdAndUserId})을 겸한다 — 값이 있으면 참가자다. 두 번 묻지
     * 않으려고 스칼라 하나만 뽑는다(보고는 저지연 경로라 엔티티·연관 fetch 를 피한다).
     */
    @Query("SELECT p.createdAt FROM GroupChallengeBetParticipant p "
            + "WHERE p.session.id = :sessionId AND p.user.id = :userId")
    Optional<Instant> findJoinedAtBySessionIdAndUserId(@Param("sessionId") UUID sessionId,
                                                       @Param("userId") UUID userId);

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
     */
    @Query("SELECT p.id AS participantId, p.session.id AS sessionId "
            + "FROM GroupChallengeBetParticipant p JOIN p.session s "
            + "WHERE p.user.id = :userId AND p.achieved IS NULL "
            + "AND s.status = com.oneorthree.phone.group.domain.GroupBetStatus.OPEN "
            + "AND s.sessionDate IN :dates "
            + "AND s.missionCategory = com.oneorthree.phone.group.domain.MissionCategory.FOCUS "
            + "ORDER BY s.id")
    List<UnconfirmedFocusTarget> findUnconfirmedOpenFocusTargetsByUserAndDates(
            @Param("userId") UUID userId,
            @Param("dates") Collection<LocalDate> dates);

    /** {@link #findUnconfirmedOpenFocusTargetsByUserAndDates} 프로젝션 — 참가 행 · 그 회차. */
    interface UnconfirmedFocusTarget {
        UUID getParticipantId();

        UUID getSessionId();
    }

    /**
     * 조기 정산 전원 확정 검사(GROMO-1268) — 미확정({@code achieved IS NULL}) 참가자 수.
     * {@code AFTER_COMMIT} 리스너가 커밋된 상태 기준으로 세고, 최종 판정은 {@code settle(EARLY)}
     * 가 회차 락 안에서 다시 한다(리스너의 무락 검사는 낡았을 수 있다 — LLD §5.2).
     */
    @Query("SELECT COUNT(p) FROM GroupChallengeBetParticipant p "
            + "WHERE p.session.id = :sessionId AND p.achieved IS NULL")
    long countBySessionIdAndAchievedIsNull(@Param("sessionId") UUID sessionId);

    /**
     * 잠금 후 재조회용 단건 — 회차 행 잠금을 잡은 <b>뒤</b> 내 참가 행이 아직 있는지 다시 본다
     * (1258 P0 이중 환불 재발 방지: 잠금 대기 중 취소·탈퇴가 이미 처리했으면 없어야 정상).
     */
    @EntityGraph(attributePaths = "user")
    Optional<GroupChallengeBetParticipant> findBySessionIdAndUserId(UUID sessionId, UUID userId);

    /**
     * 조회 조립·정산 공용 배치 로드. 응답에 닉네임이 필요하고 정산도 userId 를 봐야 하므로
     * user 를 함께 fetch 해 참가자 수만큼의 추가 SELECT 를 막는다.
     */
    @EntityGraph(attributePaths = "user")
    List<GroupChallengeBetParticipant> findBySessionIdIn(Collection<UUID> sessionIds);

    /**
     * 내 OPEN 회차(GROMO-1415, N43 보고 대상 탐색축) — <b>참가자 스코프, 그룹 무관</b>. 그룹
     * 멤버십을 경유하지 않는 이유: 탈퇴·강퇴 후에도 시작된 회차의 참가는 정산 대상으로 남는데
     * (C8·N19), 그룹 목록 축으로는 그 회차를 영영 못 찾는다. 회차 스냅샷(창 시각·목표)을 응답에
     * 실어야 하므로 session 을 함께 fetch 한다.
     */
    @Query("SELECT p FROM GroupChallengeBetParticipant p JOIN FETCH p.session s "
            + "WHERE p.user.id = :userId "
            + "AND s.status = com.oneorthree.phone.group.domain.GroupBetStatus.OPEN "
            + "ORDER BY s.sessionDate, s.id")
    List<GroupChallengeBetParticipant> findOpenSessionParticipationsByUserId(@Param("userId") UUID userId);

    /**
     * 선점·확인 실패 사유 판정용 <b>스냅샷</b>(GROMO-1577) — 조건부 UPDATE 가 0행을 돌려줬을 때
     * 그 이유를 가르는 읽기다. 엔티티 대신 스칼라 셋만 뽑는 이유: 회차 상태를 보려고 엔티티를
     * 읽으면 {@code session} 이 지연 프록시라 트랜잭션 밖 호출에서 터진다(시각 주입 오버로드가
     * 그 경로다). 조인 하나로 한 번에 읽는다.
     */
    @Query("SELECT p.acknowledgedAt AS acknowledgedAt, p.displayClaimedAt AS displayClaimedAt, "
            + "s.status AS sessionStatus "
            + "FROM GroupChallengeBetParticipant p JOIN p.session s "
            + "WHERE p.session.id = :sessionId AND p.user.id = :userId")
    Optional<ClaimStateView> findClaimStateBySessionIdAndUserId(
            @Param("sessionId") UUID sessionId,
            @Param("userId") UUID userId);

    /** {@link #findClaimStateBySessionIdAndUserId} 프로젝션 — 확인 시각 · 선점 시각 · 회차 상태. */
    interface ClaimStateView {
        Instant getAcknowledgedAt();

        Instant getDisplayClaimedAt();

        GroupBetStatus getSessionStatus();
    }

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
     * @param leaseCutoff 리스 만료 컷오프({@code now − 리스 수명}) — 이보다 오래된 선점은 죽은
     *                    것으로 보고 회수한다. <b>서버 시각으로만</b> 계산한다
     * @param statuses    결과로 치는 회차 상태({@link com.oneorthree.phone.group.domain.GroupBetStatus#RESULT_STATUSES})
     * @return 1 = 이 호출이 표시를 선점했다, 0 = 이미 확인됨 · 남의 리스가 살아 있음 · 아직 결과가
     *     아님 · 대상 행 없음 (구분은 호출측이 행을 다시 읽어 판정한다)
     */
    // 리포지토리 자체에 트랜잭션을 건다(NotificationSentLogRepository 클레임 메서드와 같은 관례) —
    // 호출측이 트랜잭션을 열지 않아도 이 조건부 UPDATE 자체는 원자다.
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query("UPDATE GroupChallengeBetParticipant p "
            + "SET p.displayClaimedAt = :now, p.displayClaimToken = :token "
            + "WHERE p.session.id = :sessionId AND p.user.id = :userId "
            + "AND p.acknowledgedAt IS NULL "
            + "AND (p.displayClaimedAt IS NULL OR p.displayClaimedAt < :leaseCutoff) "
            + "AND EXISTS (SELECT 1 FROM GroupChallengeBetSession s "
            + "WHERE s.id = p.session.id AND s.status IN :statuses)")
    int claimDisplay(
            @Param("sessionId") UUID sessionId,
            @Param("userId") UUID userId,
            @Param("token") UUID token,
            @Param("leaseCutoff") Instant leaseCutoff,
            @Param("statuses") Collection<GroupBetStatus> statuses,
            @Param("now") Instant now);

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
     * @return 1 = 내 선점이 유효하고 리스를 연장했다, 0 = 이미 확인됨 · 남이 재선점함 · 아직 결과가
     *     아님 · 대상 행 없음
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query("UPDATE GroupChallengeBetParticipant p "
            + "SET p.displayClaimedAt = :now "
            + "WHERE p.session.id = :sessionId AND p.user.id = :userId "
            + "AND p.acknowledgedAt IS NULL "
            + "AND p.displayClaimToken = :token "
            + "AND EXISTS (SELECT 1 FROM GroupChallengeBetSession s "
            + "WHERE s.id = p.session.id AND s.status IN :statuses)")
    int renewDisplayClaim(
            @Param("sessionId") UUID sessionId,
            @Param("userId") UUID userId,
            @Param("token") UUID token,
            @Param("statuses") Collection<GroupBetStatus> statuses,
            @Param("now") Instant now);

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
     * @return 1 = 이 호출이 확인 처리했다, 0 = 대상 행 없음 · 이미 확인됨 · 토큰 불일치 · 아직 결과가 아님
     */
    // flushAutomatically 도 함께 켠다(GROMO-801 예방) — 리그 acknowledge 와 같은 이유.
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query("UPDATE GroupChallengeBetParticipant p "
            + "SET p.acknowledgedAt = :now, p.displayClaimedAt = null, p.displayClaimToken = null "
            + "WHERE p.session.id = :sessionId AND p.user.id = :userId "
            + "AND p.acknowledgedAt IS NULL "
            + "AND p.displayClaimToken = :token "
            + "AND EXISTS (SELECT 1 FROM GroupChallengeBetSession s "
            + "WHERE s.id = p.session.id AND s.status IN :statuses)")
    int acknowledge(
            @Param("sessionId") UUID sessionId,
            @Param("userId") UUID userId,
            @Param("token") UUID token,
            @Param("statuses") Collection<GroupBetStatus> statuses,
            @Param("now") Instant now);

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
