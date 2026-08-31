package com.oneorthree.phone.notification.service;

import com.fasterxml.uuid.Generators;
import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.notification.repository.domain.NotificationSendStatus;
import com.oneorthree.phone.notification.repository.domain.NotificationSentLog;
import com.oneorthree.phone.notification.dto.PushDispatchSummaryResponse;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 정산 직전의 <b>사일런트</b> 푸시 (GROMO-1281, FR-22) — 회차 참가자에게 data-only
 * {@code {silent:'flush'}} 를 보내 앱의 업로드 큐(집중 세션·창 사용분) flush 를 유도한다.
 *
 * <p><b>발송 시점 = {@code settle_after} − 15분</b>(HLD §6 시각 표 · LLD §2.1 · PRD). 큐가 비워질
 * 시간은 남기되 <b>정산 직전</b>이라 마지막 15분 버킷까지 판정에 반영된다. 그레이스 진입 시점
 * (창 종료 직후)으로 당기면 SCREEN_TIME 창형이 <b>마지막 버킷이 확정되기 전 값</b>으로 보고하고,
 * 회차당 1회 클레임이라 두 번째 기상이 없어 그대로 오판정이 된다(판정 소스가 15분 눈금 클라
 * 보고분 — N4). 슬롯을 스냅샷({@code settle_after})에서 계산하는 방식은 모집 알림
 * ({@link SessionOpenNotificationService})과 같은 규율이다.
 *
 * <p>5분 크론이 이 15분 폭을 3틱 훑지만 <b>회차당 1회</b>는 사건 클레임
 * ({@code (user, BET_SILENT_FLUSH, 회차 id)} 선점 — N41 과 같은 축)이 보장한다 — 첫 틱만 나가고
 * 나머지 두 틱은 dedup 으로 접힌다.
 *
 * <p><b>대상에서 빠지는 조합은 {@code SCREEN_TIME × DURATION} 하나뿐</b>이다(HLD §6). 특히
 * {@code FOCUS × DURATION} 은 {@code settle_after} 가 KST 자정+1h 라 사일런트가 심야에 나가는데,
 * 조용한 시간(23–07)이 사일런트 예외인 이유가 정확히 이 케이스다 — 여기서 빼면 그 구제가 사라진다.
 *
 * <p>⚠️ <b>제외된 조합은 정산 전 사일런트를 전혀 받지 못한다.</b> HLD §6(638–641행)은 그 대신
 * <b>11:30 별도 사일런트</b>를 보내기로 정했으나 <b>그 트리거는 구현되지 않았다</b>(저장소 어디에도
 * 11:30 진입점이 없다). 백그라운드 전달 자체가 불확실해 사일런트로 메울 문제인지부터 정책 축에서
 * 다시 정하기로 하고 <b>별도 후속 티켓</b>으로 뺐다(GROMO-1417 8차 리뷰 판정).
 *
 * <p><b>표시 푸시의 규칙을 타지 않는다</b>(HLD §6) — 목적이 표시가 아니라 앱 기동이므로 묶음도
 * 조용한 시간 필터도 없다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SilentFlushPushService {

    /** A2 계약(계약 §2·decisions R0·A2) — 앱 백그라운드 핸들러는 data.silent == 'flush' 만 처리한다. */
    static final String SILENT_KEY = "silent";
    static final String SILENT_VALUE = "flush";

    /**
     * 발송 선행 시간 — {@code settle_after} 15분 전(HLD §6). 이 폭이 곧 스캔 창이다:
     * {@code settle_after − 15분 ≤ now < settle_after}. 5분 크론에서 3틱에 걸치지만 클레임이
     * 첫 틱만 통과시킨다.
     */
    static final Duration SETTLE_LEAD = Duration.ofMinutes(15);

    private final GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    private final GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    private final NotificationSentLogRepository notificationSentLogRepository;
    private final PushNotificationService pushNotificationService;

    /** 스케줄러(5분)·수동 트리거 진입점. */
    @Transactional
    public PushDispatchSummaryResponse sendGraceFlushPushes() {
        return sendGraceFlushPushes(Instant.now());
    }

    /** {@code settle_after} − 15분 창 스캔 → 참가자별 클레임 → data-only 발송. */
    @Transactional
    public PushDispatchSummaryResponse sendGraceFlushPushes(Instant now) {
        long startedAtMillis = System.currentTimeMillis();
        List<GroupChallengeBetSession> sessions = groupChallengeBetSessionRepository
                .findSilentFlushTargets(now, now.plus(SETTLE_LEAD));
        if (sessions.isEmpty()) {
            return summary(0, 0, 0, 0, startedAtMillis);
        }
        Map<UUID, GroupChallengeBetSession> sessionsById = sessions.stream()
                .collect(Collectors.toMap(GroupChallengeBetSession::getId, Function.identity()));
        List<GroupChallengeBetParticipant> targets = groupChallengeBetParticipantRepository
                .findBySessionIdIn(sessionsById.keySet()).stream()
                .filter(p -> !p.getUser().isDeleted())
                .toList();

        int sent = 0;
        int deduped = 0;
        int skipped = 0;
        for (GroupChallengeBetParticipant participant : targets) {
            GroupChallengeBetSession session = sessionsById.get(participant.getSession().getId());
            if (session == null) {
                skipped++;
                continue;
            }
            User user = participant.getUser();
            UUID rowId = Generators.timeBasedEpochRandomGenerator().generate();
            // 선점(사건 = 유저 × BET_SILENT_FLUSH × 회차) — 15분 창을 3틱 훑어도, 다중 인스턴스가
            // 동시에 돌아도 1회만 나가게 한다. 슬롯 메타는 실제 발송 시각이 아니라 설계상의 슬롯
            // (settle_after − 15분)을 박아 어느 틱이 집었든 같은 값이 남게 한다.
            // 리스 만료 재클레임은 두지 않는다: 창이 15분뿐이라 죽은 선점을 되살릴 실익이 작고,
            // 사일런트는 유실돼도 포그라운드 sync 가 최후 보루다.
            int claimed = notificationSentLogRepository.insertPendingClaim(rowId, user.getId(),
                    NotificationSentLog.TYPE_BET_SILENT_FLUSH, session.getId(),
                    session.getGroup().getId(), session.getSettleAfter().minus(SETTLE_LEAD), now);
            if (claimed == 0) {
                deduped++;
                continue;
            }
            PushMessage message = PushMessage.silent(Map.of(
                    SILENT_KEY, SILENT_VALUE,
                    "groupId", session.getGroup().getId().toString()));
            try {
                if (pushNotificationService.sendSilentPush(user, message)) {
                    notificationSentLogRepository.updateStatusByIds(
                            List.of(rowId), NotificationSendStatus.SENT, now);
                    sent++;
                } else {
                    // 토큰 없음·실패 — 선점을 반납해 15분 창이 남아 있으면 다음 5분 틱이 재시도.
                    notificationSentLogRepository.deleteByIds(List.of(rowId));
                    skipped++;
                }
            } catch (RuntimeException e) {
                notificationSentLogRepository.deleteByIds(List.of(rowId));
                skipped++;
                log.warn("사일런트 flush 푸시 실패 — userId={}, sessionId={}",
                        user.getId(), session.getId(), e);
            }
        }
        PushDispatchSummaryResponse result =
                summary(targets.size(), sent, deduped, skipped, startedAtMillis);
        if (result.targetCount() > 0) {
            log.info("사일런트 flush 푸시 — 정산 임박 회차 {}건, 대상 {}명, 발송 {}건, dedup {}건, 스킵 {}건",
                    sessions.size(), result.targetCount(), result.sentCount(),
                    result.dedupedCount(), result.skippedCount());
        }
        return result;
    }

    private PushDispatchSummaryResponse summary(
            int targetCount, int sent, int deduped, int skipped, long startedAtMillis) {
        return new PushDispatchSummaryResponse(
                targetCount, sent, deduped, skipped, System.currentTimeMillis() - startedAtMillis);
    }
}
