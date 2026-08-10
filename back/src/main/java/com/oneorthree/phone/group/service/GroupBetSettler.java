package com.oneorthree.phone.group.service;

import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.service.CurrencyLedgerService;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupBetVoidReason;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.domain.SettleTrigger;
import com.oneorthree.phone.group.event.GroupBetSessionClosedEvent;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.user.domain.User;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 회차 정산의 <b>단일 진입점</b>(GROMO-1411) — 모든 트리거(CRON·EARLY·MANUAL)가
 * {@link #settle(UUID, SettleTrigger)} 하나로 들어온다. 이 클래스의 트랜잭션 경계가 곧
 * "회차 단위 롤백"의 단위다.
 *
 * <p>진입 즉시 회차 행을 잠그고({@code FOR UPDATE}), <b>24h 환불 판정(N21)을 트리거 불문 가장
 * 먼저</b> 본다 — 검사가 스캔 크론에만 있으면 수동(MANUAL)·조기(EARLY) 경로가 데드라인을 그대로
 * 우회한다(스케줄러 장애를 복구하려고 운영자가 부르는 바로 그 상황이 24h 를 넘긴 시점이라, 환불돼야
 * 할 회차에 지급이 나간다 — FR-45 위반). 24h 는 예외 횟수가 아니라 <b>시각</b>에 걸린 약속이다.
 *
 * <p>배치 진입점({@link GroupBetSettlementService}·{@code GroupBetScheduler})과 클래스를 나눈 이유는
 * 자기 호출(self-invocation)로는 프록시를 타지 않아 건별 트랜잭션이 성립하지 않기 때문이다.
 *
 * <p><b>달성 판정은 {@link GroupBetJudge} 가 조합별로 한다</b> — 챌린지 카드가 보여주는 진행률과 같은
 * 소스·같은 날짜 버킷을 쓴다. 목표분은 회차에 <b>박제된 스냅샷</b>(GROMO-1263)이 기준이다. 조기
 * 확정된 참가자({@code achieved == true}, GROMO-1268)는 <b>불가역</b>으로 승자에 남되, 진행분은
 * 전원 정산 시점 최종값으로 다시 잰다 — 박제값으로 잔여 코인 순위를 매기면 잔여가 엉뚱한 승자에게
 * 간다(LLD §5.2).
 *
 * <p><b>인원 게이트(N47·N52)</b>: 0명이면 {@code UNUSED}(결과·내역·알림 제외), 1명이면
 * {@code VOIDED}(INSUFFICIENT_PARTICIPANTS) + 환불. 주 처리는 참가 마감 크론
 * ({@link #closeShortOrUnused})이고, 정산 본체의 게이트는 경합·크론 지연 대비 <b>안전망</b>이다.
 *
 * <p>재실행·동시 실행 방어는 4중이다: ① 첫 조회가 회차 행 잠금(FOR UPDATE), ② status OPEN 재확인,
 * ③ 지급 직전 원자적 CAS({@link GroupChallengeBetSessionRepository#compareAndSetSettled}),
 * ④ {@code currency_transactions.idempotency_key} 유니크(참가 행 축 — FR-42)가 최후 방어선이다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GroupBetSettler {

    /** 정산 데드라인(N21) — {@code settle_after} 로부터 이 시간이 지나면 정산 대신 전원 환불한다. */
    public static final Duration REFUND_DEADLINE = Duration.ofHours(24);

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    private final GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    private final FocusSessionRepository focusSessionRepository;
    private final CurrencyLedgerService currencyLedgerService;
    private final GroupBetJudge groupBetJudge;
    private final ApplicationEventPublisher eventPublisher;

    /**
     * 정산 결과.
     *
     * @param status  정산 후 회차 상태
     * @param applied 이번 호출이 실제로 상태를 전이시켰으면 true. 이미 종료됐거나 가드에 걸려
     *                아무 것도 하지 않았으면 false(가드 스킵은 status 가 그대로 OPEN 이다)
     */
    public record SettleResult(GroupBetStatus status, boolean applied) {

        static SettleResult skipped(GroupBetStatus status) {
            return new SettleResult(status, false);
        }
    }

    /**
     * 회차 정산 단일 진입점(LLD §5.2). 가드 순서가 곧 정책이다:
     * <ol>
     *   <li>회차 행 잠금 → {@code status != OPEN} 이면 즉시 반환(멱등)</li>
     *   <li><b>24h 데드라인(N21) — 트리거 공통 최우선</b>: 초과면 전원 환불(REFUND_DEADLINE) 후 종료</li>
     *   <li>EARLY: 참가 마감·전원 확정을 <b>락 안에서 재검증</b>(리스너의 무락 검사는 낡았을 수
     *       있다 — 마감 직전 join 이 커밋됐으면 방금 들어온 미확정 참가자를 패배로 확정하게 된다).
     *       그레이스 가드는 <b>우회</b>한다(N32 — 창형 settle_after 는 창 끝+30분이라 가드를 타면
     *       즉시 정산이 영영 발동하지 않는다)</li>
     *   <li>CRON·MANUAL: 그레이스({@code settle_after}) 미경과면 스킵, 창형 FOCUS 는 참가자의
     *       창 겹침 ACTIVE 세션이 남아 있으면 틱 스킵(N37 — 다음 크론이 재시도)</li>
     *   <li>인원 재확인: 0명 → UNUSED, 1명 → VOIDED + 환불(안전망 — 주 처리는 1412 크론)</li>
     * </ol>
     *
     * <p><b>{@code REQUIRES_NEW}</b> — "회차 1건 = 트랜잭션 1개"(LLD 트랜잭션 경계)를 진입점
     * 성격과 무관하게 강제한다. 특히 EARLY 는 {@code AFTER_COMMIT} 리스너에서 호출되는데, 그
     * 시점의 스레드에는 <b>이미 커밋이 끝난</b> 트랜잭션 컨텍스트가 남아 있어 REQUIRED 로 합류하면
     * 잠금 쿼리가 {@code TransactionRequiredException}(No active transaction)으로 터진다 — 새
     * 트랜잭션을 여는 것이 Spring 이 문서화한 유일한 해법이다.
     *
     * @throws IllegalStateException 분배 불변식 위반 — 이 회차만 롤백된다
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public SettleResult settle(UUID sessionId, SettleTrigger trigger) {
        // 잠금 조회 — 참가·철회·탈퇴 연동(참가 행 삭제 + 환불)·조기 확정과 회차 단위로 직렬화한다.
        // 참가자 읽기가 잠금 없이 이뤄지면 낡은 스냅샷이 이미 환불된 참가자에게 지급까지 해 이중
        // 지급이 된다. status CAS 는 상태 전이만 지킬 뿐 참가자 읽기는 못 지킨다.
        GroupChallengeBetSession session = groupChallengeBetSessionRepository.findByIdForUpdate(sessionId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.BET_NOT_FOUND));
        if (!session.isOpen()) {
            log.info("회차 정산 스킵 — 이미 종료됨. sessionId={}, status={}, trigger={}",
                    sessionId, session.getStatus(), trigger);
            return SettleResult.skipped(session.getStatus());
        }

        Instant now = Instant.now();
        // ① 24h 데드라인은 모든 진입점에서 먼저 — 락 안이라 크론·수동·조기 어디로 와도 동일(N21).
        if (now.isAfter(session.getSettleAfter().plus(REFUND_DEADLINE))) {
            return refundAll(session, GroupBetVoidReason.REFUND_DEADLINE, trigger);
        }

        // 잠금 이후 읽기 — 잠금 대기 중 취소·철회·탈퇴 연동이 행을 지웠을 수 있다(계약 §3 재조회).
        List<GroupChallengeBetParticipant> participants =
                groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(sessionId));

        if (trigger == SettleTrigger.EARLY) {
            // ② EARLY 전제를 락 안에서 재검증 — 걸리면 그냥 return, 크론이 제때 정산한다.
            // 마감 기준은 <b>실효 참가 마감</b>(브리지 기간 = closes_at)이다. 박제된
            // join_closes_at(창형 = 창 시작)으로 보면, 창 시작 후 기존 참가자 전원이 달성한 순간
            // 회차가 즉시 정산돼 아직 허용 시간인 구앱의 후속 참가가 BET_CLOSED 로 거절된다
            // (구앱 가드 requireWindowStillOpen 은 창 종료까지 받는다). 무산 크론과 같은 기준·같은
            // 이유다. 하루형은 두 값이 같아 동작 불변이고 창형만 움직인다.
            if (now.isBefore(effectiveJoinDeadline(session))) {
                return SettleResult.skipped(session.getStatus());
            }
            if (participants.isEmpty()
                    || participants.stream().anyMatch(p -> p.getAchieved() == null)) {
                return SettleResult.skipped(session.getStatus());
            }
        } else {
            if (now.isBefore(session.getSettleAfter())) {
                return SettleResult.skipped(session.getStatus());
            }
            if (shouldWaitForActiveFocusSessions(session, participants)) {
                log.info("회차 정산 대기 — 창 겹침 ACTIVE 집중 세션 잔존(N37), 다음 틱 재시도. "
                        + "sessionId={}, trigger={}", sessionId, trigger);
                return SettleResult.skipped(session.getStatus());
            }
        }

        // 인원 재확인(N47·N52) — 참가 마감 크론이 주 처리 경로고 여기는 안전망이다.
        if (participants.isEmpty()) {
            return closeUnused(session);
        }
        if (participants.size() < 2) {
            return voidAndRefund(session, participants, GroupBetVoidReason.INSUFFICIENT_PARTICIPANTS);
        }

        // 목표 기준은 회차 박제값(GROMO-1263). CTI 상세가 유실됐으면 판정 소스(창 시각)를 몰라
        // 정산할 수 없다 — 이 건만 롤백시킨다.
        GroupBetJudge.Target target = targetOf(session);

        List<User> users = participants.stream().map(GroupChallengeBetParticipant::getUser).toList();
        Map<UUID, Integer> progressMinutes =
                groupBetJudge.progressMinutes(target, session.getSessionDate(), users);
        List<GroupBetPayoutCalculator.Entry> entries = participants.stream()
                .map(p -> {
                    UUID userId = p.getUser().getId();
                    // 실측이 없으면 박제된 근거로 폴백한다(계정 탈퇴 근거 박제 GROMO-1423) —
                    // 탈퇴로 통계가 익명화돼도 그 참가자의 판정 근거가 사라지지 않는다.
                    Integer minutes = measuredOrFrozen(progressMinutes.get(userId), p);
                    // 사전 박제(achieved=true — 조기 확정 GROMO-1268 / 계정 탈퇴 근거 박제 GROMO-1423)는
                    // 불가역(FR-23) — 판정을 다시 뒤집지 않는다. 실측이 있으면 진행분은 실측이 이긴다
                    // (조기 확정자의 잔여 순위가 확정 시점 박제값으로 어긋나지 않게 — LLD §5.2).
                    boolean achieved = Boolean.TRUE.equals(p.getAchieved())
                            || GroupBetJudge.isAchieved(target, minutes);
                    return new GroupBetPayoutCalculator.Entry(userId,
                            minutes == null ? 0 : minutes, achieved);
                })
                .toList();

        GroupBetPayoutCalculator.Distribution distribution = GroupBetPayoutCalculator.distribute(
                session.getStake(), GroupBetJudge.remainderRule(target), entries);

        // 여기까지는 전부 읽기다 — 돈이 움직이기 직전에 상태 전이를 원자적으로 잠근다.
        int claimed = groupChallengeBetSessionRepository.compareAndSetSettled(
                sessionId, distribution.status(), null, Instant.now());
        if (claimed == 0) {
            GroupBetStatus current = groupChallengeBetSessionRepository.findStatusById(sessionId)
                    .orElseThrow(() -> new GroupException(GroupErrorCode.BET_NOT_FOUND));
            log.info("회차 정산 스킵 — 동시 실행에서 다른 트랜잭션이 먼저 정산함. sessionId={}, status={}",
                    sessionId, current);
            return SettleResult.skipped(current);
        }

        apply(session, participants, distribution, evidenceMinutes(target, participants, progressMinutes));

        log.info("회차 정산 완료 — sessionId={}, sessionDate={}, category={}, type={}, status={}, pot={}, "
                + "trigger={}, 참가자={}",
                sessionId, session.getSessionDate(), session.getMissionCategory(),
                session.getMissionType(), distribution.status(), distribution.pot(), trigger,
                participants.size());
        // 결과 알림 트리거(GROMO-1417) — AFTER_COMMIT 리스너가 받으므로 지급 커밋 전에 나가지 않는다.
        eventPublisher.publishEvent(new GroupBetSessionClosedEvent(sessionId));
        return new SettleResult(distribution.status(), true);
    }

    /**
     * 참가 마감 인원 미달 즉시 처리(GROMO-1412, N47·FR-36) — 5분 크론의 건별 진입점. 잠금 안에서
     * 마감·인원을 재확인해 <b>0명이면 UNUSED, 1명이면 VOIDED + 환불</b>로 닫는다(N52 는 전 종료
     * 경로 적용). 잠금 대기 중 참가가 들어와 2명 이상이 됐으면 아무것도 하지 않는다 — 정상 정산
     * 대상이다.
     */
    @Transactional
    public SettleResult closeShortOrUnused(UUID sessionId) {
        GroupChallengeBetSession session = groupChallengeBetSessionRepository.findByIdForUpdate(sessionId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.BET_NOT_FOUND));
        if (!session.isOpen()) {
            return SettleResult.skipped(session.getStatus());
        }
        if (Instant.now().isBefore(effectiveJoinDeadline(session))) {
            return SettleResult.skipped(session.getStatus());
        }
        List<GroupChallengeBetParticipant> participants =
                groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(sessionId));
        if (participants.isEmpty()) {
            return closeUnused(session);
        }
        if (participants.size() >= 2) {
            return SettleResult.skipped(session.getStatus());
        }
        return voidAndRefund(session, participants, GroupBetVoidReason.INSUFFICIENT_PARTICIPANTS);
    }

    /**
     * 챌린지 삭제 연동(GROMO-1272, FR-12) — 이 챌린지의 OPEN 회차(예약된 미래 포함) 전부를
     * {@code VOIDED}(CHALLENGE_DELETED)로 무효화하고 참가비를 전원 환불한다. 정산 완료 회차는
     * status 게이트로 자연히 제외된다(FR-13 — 확정된 결과·지급은 불변).
     *
     * <p>호출 전제: {@code GroupChallengeService.deleteChallenge} 가 챌린지 행 배타 락을 쥔
     * <b>같은 트랜잭션</b> 안 — 참여·개설 경로(챌린지 행 락 공유)와 직렬화된다. 잠금 대기 중
     * 정산·철회가 끝난 회차는 최종 상태를 존중해 건너뛴다.
     *
     * <p><b>잠금 순서(계약 §3)는 "회차 id 오름차순 → 지갑 userId 오름차순"이고, 지갑 순서는 회차
     * 안이 아니라 전역이어야 성립한다.</b> 회차마다 그 회차 참가자만 정렬해 지갑을 건드리면,
     * 참가자가 겹치는 두 챌린지를 동시에 삭제할 때 한쪽은 (회차1의 B → 회차2의 A), 다른 쪽은
     * (A → B) 순서가 되어 <b>서로의 지갑 행 락을 기다리는 교착</b>이 난다(원장 조회가 앞선 지갑
     * 변경을 flush 하므로 락은 실제로 잡혀 있다). 그래서 여기서는 회차를 id 오름차순으로 전부
     * 잠그고 → 상태 전이·근거 기록까지 마친 뒤 → <b>전 회차의 환불 대상을 합쳐 userId 전역
     * 오름차순</b>으로 지갑을 움직인다.
     *
     * @return 무효화(VOIDED·UNUSED)한 회차 수
     */
    @Transactional
    public int voidOpenSessionsForChallengeDelete(UUID challengeId) {
        List<UUID> sessionIds =
                groupChallengeBetSessionRepository.findOpenSessionIdsByChallengeId(challengeId);
        List<GroupChallengeBetSession> lockedOpenSessions = new ArrayList<>();
        for (UUID sessionId : sessionIds) {
            groupChallengeBetSessionRepository.findByIdForUpdate(sessionId)
                    .filter(GroupChallengeBetSession::isOpen)
                    .ifPresent(lockedOpenSessions::add);
        }
        // 상태 전이(CAS)와 환불 근거 기록은 회차별로 끝내되, <b>지갑은 건드리지 않고</b> 대상만
        // 모은다 — 지갑 순서를 회차 안에서만 맞추면 여러 회차를 걸칠 때 전역 순서가 깨진다(아래).
        int voided = 0;
        List<PendingRefund> pending = new ArrayList<>();
        for (GroupChallengeBetSession session : lockedOpenSessions) {
            List<GroupChallengeBetParticipant> participants = groupChallengeBetParticipantRepository
                    .findBySessionIdIn(List.of(session.getId()));
            if (participants.isEmpty()) {
                closeUnused(session);
            } else {
                pending.addAll(voidAndCollectRefunds(
                        session, participants, GroupBetVoidReason.CHALLENGE_DELETED));
            }
            voided++;
        }
        // 지갑은 마지막에 <b>userId 전역 오름차순</b>으로 한 번에 움직인다(계약 §3).
        applyRefunds(pending);
        if (voided > 0) {
            log.info("챌린지 삭제 연동 — OPEN 회차 {}건 무효화·환불. challengeId={}", voided, challengeId);
        }
        return voided;
    }

    /**
     * 24h 데드라인 전원 환불(N21) — {@code REFUNDED} + 사유 {@code REFUND_DEADLINE}. 참가자가
     * 없으면 환불 대상이 없으므로 {@code UNUSED} 로 닫는다(N52 — 0명 종료는 결과가 아니다).
     * 호출 전제: 회차 행 잠금 아래.
     */
    private SettleResult refundAll(
            GroupChallengeBetSession session, GroupBetVoidReason reason, SettleTrigger trigger) {
        List<GroupChallengeBetParticipant> participants =
                groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(session.getId()));
        if (participants.isEmpty()) {
            return closeUnused(session);
        }
        if (groupChallengeBetSessionRepository.compareAndSetSettled(
                session.getId(), GroupBetStatus.REFUNDED, reason, Instant.now()) == 0) {
            // 행 잠금 아래라 도달 불가 — 도달했다면 잠금 규율이 깨진 것이다.
            throw new IllegalStateException("REFUNDED 전이 실패 — sessionId=" + session.getId());
        }
        applyRefunds(participants.stream().map(p -> new PendingRefund(session, p)).toList());
        log.error("회차 자동 환불 — 24h 데드라인 초과(N21). sessionId={}, sessionDate={}, trigger={}, "
                + "참가자={}, stake={}",
                session.getId(), session.getSessionDate(), trigger, participants.size(),
                session.getStake());
        // BET_VOID_REFUND 푸시 트리거(N48) — AFTER_COMMIT 리스너 경유라 환불 커밋 전 발송이 없다.
        eventPublisher.publishEvent(new GroupBetSessionClosedEvent(session.getId()));
        return new SettleResult(GroupBetStatus.REFUNDED, true);
    }

    /** 지갑 집행을 미룬 환불 1건 — 회차를 걸쳐 모은 뒤 userId 전역 오름차순으로 처리한다. */
    private record PendingRefund(GroupChallengeBetSession session,
            GroupChallengeBetParticipant participant) {
    }

    /**
     * 인원 미달·챌린지 삭제 무산 — {@code VOIDED} + 사유 기록(N33) + 전원 환불.
     * <b>단일 회차</b> 경로 전용이다(회차가 하나뿐이라 전역 순서 = 회차 안 순서).
     * 여러 회차를 한 트랜잭션에서 처리하는 경로는
     * {@link #voidAndCollectRefunds} + {@link #applyRefunds} 로 지갑 순서를 전역화해야 한다.
     * 회차 행 잠금 아래 전제.
     */
    private SettleResult voidAndRefund(GroupChallengeBetSession session,
            List<GroupChallengeBetParticipant> participants, GroupBetVoidReason reason) {
        applyRefunds(voidAndCollectRefunds(session, participants, reason));
        return new SettleResult(GroupBetStatus.VOIDED, true);
    }

    /**
     * 무산 상태 전이 + 환불 근거 기록까지만 하고 <b>지갑은 건드리지 않는다</b> — 집행 대상을
     * 돌려준다. 지갑 순서를 호출측이 전역으로 정할 수 있게 하기 위한 분리다.
     */
    private List<PendingRefund> voidAndCollectRefunds(GroupChallengeBetSession session,
            List<GroupChallengeBetParticipant> participants, GroupBetVoidReason reason) {
        if (groupChallengeBetSessionRepository.compareAndSetSettled(
                session.getId(), GroupBetStatus.VOIDED, reason, Instant.now()) == 0) {
            throw new IllegalStateException("VOIDED 전이 실패 — sessionId=" + session.getId());
        }
        log.info("회차 무산 — sessionId={}, sessionDate={}, reason={}, 참가자={}, stake={} 환불",
                session.getId(), session.getSessionDate(), reason, participants.size(),
                session.getStake());
        // BET_VOID_REFUND 푸시 트리거(N48) — AFTER_COMMIT 리스너 경유라 환불 커밋 전 발송이 없다.
        eventPublisher.publishEvent(new GroupBetSessionClosedEvent(session.getId()));
        return participants.stream().map(p -> new PendingRefund(session, p)).toList();
    }

    /**
     * <b>실효 참가 마감</b> — 브리지 기간(N36)에는 {@code closes_at} 이다.
     *
     * <p>회차에 박제된 {@code join_closes_at} 은 to-be 정의(창형 = 창 시작, LLD §1.1)인데, 구앱
     * 참가 가드({@code GroupBetService.requireWindowStillOpen})는 여전히 <b>창 종료까지</b> 받는다.
     * 그래서 "참가가 끝났다"를 판정하는 곳은 전부 이 메서드 하나를 지나야 한다 — 기준이 갈리면
     * 어떤 경로는 아직 참가를 받고 어떤 경로는 이미 회차를 닫는 비일관이 생긴다.
     * 하루형은 두 값이 같아 이 보정으로 동작이 달라지지 않는다.
     *
     * <p>⚠️ <b>B8 이 참가 마감을 {@code join_closes_at} 으로 전환할 때 되돌릴 보정 3곳</b>:
     * ① 이 메서드(EARLY 재검증·{@code closeShortOrUnused} 공용), ② 무산 크론 스캔 술어
     * ({@code findOpenPastJoinDeadlineWithFewParticipants} 의 {@code closes_at}),
     * ③ 구앱 참가 가드 자체. 전환 후에는 두 값이 같은 의미라 보정이 불필요해진다.
     */
    static Instant effectiveJoinDeadline(GroupChallengeBetSession session) {
        return session.getClosesAt();
    }

    /** 참가자 0명 종료(N52) — 지급·환불·알림이 없는 정리다. 회차 행 잠금 아래 전제. */
    private SettleResult closeUnused(GroupChallengeBetSession session) {
        if (groupChallengeBetSessionRepository.compareAndSetSettled(
                session.getId(), GroupBetStatus.UNUSED, null, Instant.now()) == 0) {
            throw new IllegalStateException("UNUSED 전이 실패 — sessionId=" + session.getId());
        }
        log.info("회차 미사용 종료 — 참가자 0명. sessionId={}", session.getId());
        return new SettleResult(GroupBetStatus.UNUSED, true);
    }

    /**
     * 환불 집행 — <b>지갑 userId 전역 오름차순</b>(계약 §3 잠금 순서). 여러 회차의 대상을 함께
     * 받아 한 번에 정렬하므로, 같은 유저가 여러 회차에 걸쳐 있어도 지갑을 잡는 순서가 트랜잭션
     * 전체에서 단조롭다 — 동시 삭제 두 건이 서로의 지갑을 역순으로 기다리는 교착이 성립하지 않는다.
     * 같은 유저의 여러 회차는 sessionId 로 2차 정렬해 순서를 결정적으로 고정한다.
     *
     * <p>키는 경로 불문 단일 환불 축 {@code session:{sid}:refund:{participantId}}(FR-42) 라
     * 취소·탈퇴 등 다른 경로와 겹쳐도 원장 UNIQUE 가 이중 환불을 막는다. 탈퇴자(지갑 삭제)는 지급
     * 스킵 — 정산의 탈퇴자 처리와 같은 이유.
     */
    private void applyRefunds(List<PendingRefund> refunds) {
        List<PendingRefund> ordered = refunds.stream()
                .sorted(Comparator
                        .<PendingRefund, UUID>comparing(r -> r.participant().getUser().getId())
                        .thenComparing(r -> r.session().getId()))
                .toList();
        for (PendingRefund refund : ordered) {
            GroupChallengeBetSession session = refund.session();
            GroupChallengeBetParticipant participant = refund.participant();
            participant.recordRefund(session.getStake());
            User user = participant.getUser();
            if (user.isDeleted()) {
                log.warn("회차 환불 스킵 — 탈퇴한 참가자라 지갑이 없다. sessionId={}, userId={}, stake={}",
                        session.getId(), user.getId(), session.getStake());
                continue;
            }
            boolean applied = currencyLedgerService.credit(user, CurrencyTransactionType.BET_REFUND,
                    session.getStake(), GroupBetService.refundKey(session.getId(), participant.getId()));
            if (!applied) {
                log.warn("회차 환불 스킵 — 멱등키 선점됨(버그 신호). sessionId={}, userId={}, key={}",
                        session.getId(), user.getId(),
                        GroupBetService.refundKey(session.getId(), participant.getId()));
            }
        }
    }

    /**
     * 창형 FOCUS 정산 대기 가드(GROMO-1413, N37) — <b>FOCUS × TIME_WINDOW 에만</b> 건다.
     * SCREEN_TIME 창형의 판정 소스는 클라 보고분이라 집중 세션과 무관하다 — 카테고리를 안 가리면
     * 참가자 중 누가 마침 집중 중이라는 이유로 준비된 스크린타임 정산이 밀리고, 세션이 길면 24h
     * 자동 환불까지 간다(대기가 오히려 돈을 되돌린다). 창 경계는 회차 스냅샷(창 시각)에서 스스로
     * 계산한다 — 챌린지가 삭제돼도 판정이 온전하다.
     */
    private boolean shouldWaitForActiveFocusSessions(
            GroupChallengeBetSession session, List<GroupChallengeBetParticipant> participants) {
        if (session.getMissionCategory() != MissionCategory.FOCUS
                || session.getMissionType() != MissionType.TIME_WINDOW
                || session.getWindowStart() == null || session.getWindowEnd() == null
                || participants.isEmpty()) {
            return false;
        }
        List<UUID> userIds = participants.stream().map(p -> p.getUser().getId()).toList();
        return focusSessionRepository.existsActiveOverlappingWindow(
                userIds, windowEndOf(session));
    }

    /**
     * 회차 창 종료 Instant — 스냅샷 시각으로 계산하며 <b>종료일은 항상 회차일</b>이다.
     * V35(GROMO-1406)가 자정 걸침을 DB CHECK({@code window_start < window_end})로 금지하면서
     * {@link WindowFocusAggregator#windowEndOn} 의 D+1 분기가 사라졌다 — 대기 가드는 판정이 실제로
     * 쓰는 창과 <b>같은 경계</b>를 봐야 하므로 여기서도 같은 규칙을 쓴다(둘이 갈리면, 판정은 이미
     * 끝난 창을 보는데 대기만 계속 걸리거나 그 반대가 된다).
     */
    private static Instant windowEndOf(GroupChallengeBetSession session) {
        return session.getSessionDate().atTime(session.getWindowEnd()).atZone(KST).toInstant();
    }

    /**
     * 판정 대상 — 판정 소스(창 시각·조회 경로)는 CTI 상세에서, <b>목표분은 회차 스냅샷</b>에서 온다.
     * 스냅샷이 없는 행(V39 백필 이전 이력)만 CTI 목표로 폴백한다.
     */
    private GroupBetJudge.Target targetOf(GroupChallengeBetSession session) {
        return groupBetJudge.resolve(session.getChallenge())
                .map(t -> session.getGoalMinutes() == null
                        ? t
                        : new GroupBetJudge.Target(t.challenge(), session.getGoalMinutes(), t.window()))
                .orElseThrow(() -> new IllegalStateException(
                        "챌린지 목표 유실 — 목표를 몰라 정산할 수 없다. sessionId=" + session.getId()));
    }

    /**
     * 정산 근거로 저장할 참가자별 실측 분(GROMO-1207) — 판정({@code entries})이 실제로 쓴 값
     * 그대로다. FOCUS 의 무기록(null)은 판정이 0분으로 본 것이므로 0 으로 확정해 저장하고,
     * SCREEN_TIME 의 미보고(null)는 "미계측"이라 null 그대로 남긴다(0분 사용과 구분 — 앱 "—" 표시).
     */
    /**
     * 실측 우선, 없으면 참가 행 박제값 폴백(GROMO-1423) — 계정 탈퇴가 통계를 nullify 한 참가자는
     * 실측이 사라진다(FOCUS 0분·SCREEN_TIME 미보고로 접혀 판정·잔여 순위·근거 기록이 전부 왜곡).
     * 탈퇴 직전 박제된 {@code progressMinutes} 가 그 유저의 마지막 진실이다. 실측이 존재하는 정상
     * 참가자는 항상 실측이 이긴다(LLD §5.2 — 박제값 순위 왜곡 방지).
     */
    private static Integer measuredOrFrozen(Integer measured, GroupChallengeBetParticipant participant) {
        return measured != null ? measured : participant.getProgressMinutes();
    }

    private Map<UUID, Integer> evidenceMinutes(
            GroupBetJudge.Target target,
            List<GroupChallengeBetParticipant> participants,
            Map<UUID, Integer> progressMinutes) {
        Map<UUID, Integer> evidence = new HashMap<>();
        for (GroupChallengeBetParticipant participant : participants) {
            UUID userId = participant.getUser().getId();
            Integer minutes = measuredOrFrozen(progressMinutes.get(userId), participant);
            if (minutes == null && target.category() == MissionCategory.FOCUS) {
                minutes = 0;
            }
            evidence.put(userId, minutes);
        }
        return evidence;
    }

    private void apply(
            GroupChallengeBetSession session,
            List<GroupChallengeBetParticipant> participants,
            GroupBetPayoutCalculator.Distribution distribution,
            Map<UUID, Integer> evidenceMinutes) {
        Map<UUID, GroupChallengeBetParticipant> byUserId = new HashMap<>();
        participants.forEach(p -> byUserId.put(p.getUser().getId(), p));

        if (distribution.status() == GroupBetStatus.FORFEITED) {
            // 승자 0명 — 판정 결과만 기록하고 지급 루프는 아예 타지 않는다(전원 payout 0).
            distribution.payouts().forEach(payout ->
                    byUserId.get(payout.userId()).recordSettlement(payout.achieved(), payout.amount(),
                            evidenceMinutes.get(payout.userId())));
            log.info("회차 몰수 — sessionId={}, pot={} 소멸", session.getId(), distribution.pot());
            return;
        }

        // 지급은 userId 오름차순 — 여러 지갑을 만지는 경로(탈퇴 연동의 환불 포함)끼리
        // 지갑 잠금 순서를 맞춰 두기 위한 고정이다(계약 §3).
        List<GroupBetPayoutCalculator.Payout> ordered = distribution.payouts().stream()
                .sorted(Comparator.comparing(GroupBetPayoutCalculator.Payout::userId))
                .toList();
        for (GroupBetPayoutCalculator.Payout payout : ordered) {
            GroupChallengeBetParticipant participant = byUserId.get(payout.userId());
            participant.recordSettlement(payout.achieved(), payout.amount(),
                    evidenceMinutes.get(payout.userId()));
            if (payout.amount() <= 0) {
                continue;
            }
            User user = participant.getUser();
            if (user.isDeleted()) {
                // 탈퇴자는 지갑이 이미 삭제돼 있다. 그대로 credit 하면 지갑 조회가 터지고 트랜잭션
                // 전체가 롤백돼 회차가 OPEN 에 갇힌다 — 지급 대상에서만 빼고 정산은 끝낸다.
                // 참가 행에는 계산된 몫을 그대로 남긴다(분배 근거 보존, 원장이 단일 진실).
                log.warn("회차 지급 스킵 — 탈퇴한 참가자라 지갑이 없다. sessionId={}, userId={}, amount={}",
                        session.getId(), payout.userId(), payout.amount());
                continue;
            }
            currencyLedgerService.credit(user, CurrencyTransactionType.BET_PAYOUT, payout.amount(),
                    payoutKey(session.getId(), participant.getId()));
        }
    }

    /**
     * 멱등키 컨벤션 — 정산 지급. 축은 다른 돈 흐름과 같은 <b>참가 행 id</b> 다(FR-42).
     * 차감·환불 키는 {@link GroupBetService#stakeKey}/{@link GroupBetService#refundKey}.
     */
    static String payoutKey(UUID sessionId, UUID participantId) {
        return "session:" + sessionId + ":payout:" + participantId;
    }
}
