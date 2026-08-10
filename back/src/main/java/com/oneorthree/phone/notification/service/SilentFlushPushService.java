package com.oneorthree.phone.notification.service;

import com.fasterxml.uuid.Generators;
import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.notification.domain.NotificationSendStatus;
import com.oneorthree.phone.notification.domain.NotificationSentLog;
import com.oneorthree.phone.notification.dto.PushDispatchSummaryResponse;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.domain.User;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 창형 정산 그레이스의 <b>사일런트</b> 푸시 (GROMO-1281, FR-22) — 창이 끝나고 정산 가능 시각
 * ({@code settle_after} = 창 끝+30분) 전인 OPEN 회차의 참가자에게 data-only
 * {@code {silent:'flush'}} 를 보내 앱의 업로드 큐(집중 세션·창 사용분) flush 를 유도한다.
 * 정산이 클라 데이터를 기다릴 수 있는 마지막 창이라, B4 의 5분 정산 스캔과 같은 주기로
 * 그레이스 진입을 감지한다.
 *
 * <p><b>표시 푸시의 규칙을 타지 않는다</b>(HLD §6) — 목적이 표시가 아니라 앱 기동이므로 묶음도
 * 조용한 시간 필터도 없다(심야 창의 정산이 데이터를 못 받는 문제가 이걸로 풀린다). 다만 5분
 * 스캔이 그레이스 구간을 반복 훑으므로 <b>회차당 1회</b>는 사건 클레임
 * ({@code (user, BET_SILENT_FLUSH, 회차 id)} 선점 — N41 과 같은 축)으로 보장한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SilentFlushPushService {

    /** A2 계약(계약 §2·decisions R0·A2) — 앱 백그라운드 핸들러는 data.silent == 'flush' 만 처리한다. */
    static final String SILENT_KEY = "silent";
    static final String SILENT_VALUE = "flush";

    private final GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    private final GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    private final NotificationSentLogRepository notificationSentLogRepository;
    private final PushNotificationService pushNotificationService;

    /** 스케줄러(5분)·수동 트리거 진입점. */
    @Transactional
    public PushDispatchSummaryResponse sendGraceFlushPushes() {
        return sendGraceFlushPushes(Instant.now());
    }

    /** 그레이스 진입 회차 스캔 → 참가자별 클레임 → data-only 발송. */
    @Transactional
    public PushDispatchSummaryResponse sendGraceFlushPushes(Instant now) {
        long startedAtMillis = System.currentTimeMillis();
        List<GroupChallengeBetSession> sessions =
                groupChallengeBetSessionRepository.findWindowSessionsInSettleGrace(now);
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
            // 선점(사건 = 유저 × BET_SILENT_FLUSH × 회차) — 5분 스캔 반복·다중 인스턴스에서 1회 보장.
            // 리스 만료 재클레임은 두지 않는다: 그레이스는 30분뿐이라 죽은 선점을 되살릴 실익이 작고,
            // 사일런트는 유실돼도 포그라운드 sync 가 최후 보루다.
            int claimed = notificationSentLogRepository.insertPendingClaim(rowId, user.getId(),
                    NotificationSentLog.TYPE_BET_SILENT_FLUSH, session.getId(),
                    session.getGroup().getId(), session.getClosesAt(), now);
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
                    // 토큰 없음·실패 — 선점을 반납해 그레이스가 남아 있으면 다음 5분 틱이 재시도.
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
            log.info("사일런트 flush 푸시 — 그레이스 회차 {}건, 대상 {}명, 발송 {}건, dedup {}건, 스킵 {}건",
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
