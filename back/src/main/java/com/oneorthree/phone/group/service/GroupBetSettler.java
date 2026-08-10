package com.oneorthree.phone.group.service;

import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.service.CurrencyLedgerService;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.user.domain.User;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 내기 <b>회차 한 건</b>을 정산한다 — 이 클래스의 트랜잭션 경계가 곧 "회차 단위 롤백"의 단위다.
 *
 * <p>배치 진입점({@link GroupBetSettlementService})과 클래스를 나눈 이유는 자기 호출(self-invocation)
 * 로는 프록시를 타지 않아 건별 트랜잭션이 성립하지 않기 때문이다. 한 건이 불변식 위반으로 터져도
 * 그 건만 롤백되고 나머지 정산은 계속된다.
 *
 * <p><b>달성 판정은 {@link GroupBetJudge} 가 조합별로 한다</b> — 챌린지 카드가 보여주는 진행률과 같은
 * 소스·같은 날짜 버킷을 쓴다. 목표분은 회차에 <b>박제된 스냅샷</b>(GROMO-1263)이 기준이다 —
 * 챌린지 목표가 정산 전에 바뀌어도 이 회차의 판정 기준은 개설 시점 값으로 불변이다.
 *
 * <p><b>참가자 0명 회차는 결과가 아니다(N52·GROMO-1404)</b> — 잠금 안에서 인원을 재확인해 0명이면
 * {@code UNUSED} 로 닫는다(지급·환불·알림 없음). 재편 후에는 참가 철회가 참가 행을 지우므로
 * "잠금 대기 중 전원 이탈" 경합에서 실제로 발생할 수 있는 상태다. 인원 미달(1명) 무산({@code VOIDED}
 * + 환불)은 참가 마감 크론(B4·N47)의 몫이고, 이 정산 본체는 브리지 기간 동안 종전 규칙(단독 참가도
 * 판정·정산)을 유지한다.
 *
 * <p>재실행·동시 실행 방어는 4중이다: ① 첫 조회가 회차 행 잠금(FOR UPDATE), ② status OPEN 재확인,
 * ③ 지급 직전 원자적 CAS({@link GroupChallengeBetSessionRepository#compareAndSetSettled}),
 * ④ {@code currency_transactions.idempotency_key} 유니크(참가 행 축 — FR-42)가 최후 방어선이다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GroupBetSettler {

    private final GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    private final GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    private final CurrencyLedgerService currencyLedgerService;
    private final GroupBetJudge groupBetJudge;

    /**
     * 정산 결과.
     *
     * @param status  정산 후 회차 상태
     * @param applied 이번 호출이 실제로 상태를 전이시켰으면 true. 이미 종료됐거나 CAS 에서 밀려
     *                아무 것도 하지 않았으면 false
     */
    public record SettleResult(GroupBetStatus status, boolean applied) {
    }

    /**
     * @param sessionId 정산할 회차
     * @return 정산 후 상태 + 이번 호출이 실제로 전이시켰는지
     * @throws IllegalStateException 분배 불변식 위반 — 이 회차만 롤백된다
     */
    @Transactional
    public SettleResult settle(UUID sessionId) {
        // 잠금 조회 — 참가·철회·탈퇴 연동(참가 행 삭제 + 환불)과 회차 단위로 직렬화한다. 참가자
        // 읽기가 잠금 없이 이뤄지면 낡은 스냅샷이 이미 환불된 참가자에게 지급까지 해 이중 지급이
        // 된다. status CAS 는 상태 전이만 지킬 뿐 참가자 읽기는 못 지키므로 행 잠금으로 막는다.
        GroupChallengeBetSession session = groupChallengeBetSessionRepository.findByIdForUpdate(sessionId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.BET_NOT_FOUND));
        if (!session.isOpen()) {
            log.info("회차 정산 스킵 — 이미 종료됨. sessionId={}, status={}", sessionId, session.getStatus());
            return new SettleResult(session.getStatus(), false);
        }

        // 잠금 안 인원 재확인(GROMO-1404) — 0명이면 UNUSED 로 닫는다(결과·내역·알림 제외, N52).
        List<GroupChallengeBetParticipant> participants =
                groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(sessionId));
        if (participants.isEmpty()) {
            if (groupChallengeBetSessionRepository.compareAndSetSettled(
                    sessionId, GroupBetStatus.UNUSED, null, Instant.now()) == 0) {
                // 행 잠금 아래라 도달 불가 — 도달했다면 잠금 규율이 깨진 것이다.
                throw new IllegalStateException("UNUSED 전이 실패 — sessionId=" + sessionId);
            }
            log.info("회차 미사용 종료 — 참가자 0명. sessionId={}", sessionId);
            return new SettleResult(GroupBetStatus.UNUSED, true);
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
                    Integer minutes = progressMinutes.get(userId);
                    return new GroupBetPayoutCalculator.Entry(userId,
                            minutes == null ? 0 : minutes,
                            GroupBetJudge.isAchieved(target, minutes));
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
            return new SettleResult(current, false);
        }

        apply(session, participants, distribution, evidenceMinutes(target, participants, progressMinutes));

        log.info("회차 정산 완료 — sessionId={}, sessionDate={}, category={}, type={}, status={}, pot={}, "
                + "참가자={}",
                sessionId, session.getSessionDate(), session.getMissionCategory(),
                session.getMissionType(), distribution.status(), distribution.pot(), participants.size());
        return new SettleResult(distribution.status(), true);
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
    private Map<UUID, Integer> evidenceMinutes(
            GroupBetJudge.Target target,
            List<GroupChallengeBetParticipant> participants,
            Map<UUID, Integer> progressMinutes) {
        Map<UUID, Integer> evidence = new HashMap<>();
        for (GroupChallengeBetParticipant participant : participants) {
            UUID userId = participant.getUser().getId();
            Integer minutes = progressMinutes.get(userId);
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
