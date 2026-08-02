package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.notification.domain.NotificationSentLog;
import com.oneorthree.phone.notification.dto.PushDispatchSummaryResponse;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 내기 정산 결과 푸시(B4) — 크론 08:00 · 13:00 KST.
 *
 * <p>정산 배치는 01:00(FOCUS)·12:00(SCREEN_TIME) 에 돌지만 발송은 두 번으로 나눈다. 01:00 발송은
 * quiet hours(기본 23–07) 한복판이고, 13:00 은 12:00 정산분을 커버하기 위한 것이다. 두 크론이 같은
 * 정산분을 훑어도 무해하다 — 발송 여부의 단일 소스는 {@link NotificationSentLog} dedup
 * (type={@code BET_RESULT}, target_user_id={@code betId})이고, 실제로 발송이 성사된 건만 기록하기
 * 때문에 앞선 실행에서 못 나간 건은 뒤 실행이 자연스럽게 재시도한다.
 *
 * <p>대상 상태는 (SETTLED, FORFEITED) 뿐이다. CANCELED 는 "결과" 가 아니라 없던 일이라 알리지 않고,
 * REFUNDED 는 몰수 룰 도입 이후 정산이 만들지 않는 레거시 상태다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class BetResultNotificationService {

    /** 결과 알림을 붙일 링크 — 앱(A3)이 그룹 화면으로 이동시켜 결과 모달을 띄운다. */
    static final String GROUP_DEEP_LINK_PREFIX = "gromo://group?g=";

    /** 푸시 종류 식별자 — 앱이 data.type 으로 읽어 GA4 push_opened 를 가른다(계약 §2). */
    static final String PUSH_TYPE = NotificationSentLog.TYPE_BET_RESULT;

    /**
     * 훑을 정산 구간 — 지금부터 48시간 전까지. 하루 두 번(01:00·12:00) 정산분을 두 번의 발송
     * (08:00·13:00)이 모두 덮고, 발송이 한 번 실패한 건도 다음 크론이 다시 집을 수 있는 폭이다.
     * 이 구간을 벗어난 미발송 건은 포기한다(뒤늦은 결과 푸시가 오히려 혼란).
     */
    static final Duration SETTLEMENT_LOOKBACK = Duration.ofHours(48);

    /** 발송 이력 조회 구간 — 정산 구간보다 넉넉히 잡아 경계에서 dedup 이 새지 않게 한다. */
    private static final Duration SENT_LOG_LOOKBACK = Duration.ofDays(3);

    private static final List<GroupBetStatus> RESULT_STATUSES =
            List.of(GroupBetStatus.SETTLED, GroupBetStatus.FORFEITED);

    private final GroupChallengeBetRepository groupChallengeBetRepository;
    private final GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    private final UserNotificationSettingsRepository userNotificationSettingsRepository;
    private final NotificationSentLogRepository notificationSentLogRepository;
    private final PushNotificationService pushNotificationService;

    /** 스케줄러(08:00·13:00 KST)·수동 트리거 진입점. */
    public PushDispatchSummaryResponse sendBetResultNotifications() {
        return sendBetResultNotifications(Instant.now());
    }

    /**
     * 정산 결과 푸시 본체.
     *
     * <p>{@code PushNotificationService.sendIfAllowed} 가 무효 토큰을 만나면 유저 행의 device_token 을
     * 지우므로(더티체킹) 쓰기 트랜잭션 안에서 돌아야 한다.
     */
    @Transactional
    public PushDispatchSummaryResponse sendBetResultNotifications(Instant now) {
        long startedAtMillis = System.currentTimeMillis();
        List<GroupChallengeBet> bets = groupChallengeBetRepository.findByStatusInAndSettledAtSince(
                RESULT_STATUSES, now.minus(SETTLEMENT_LOOKBACK));
        if (bets.isEmpty()) {
            log.info("내기 결과 푸시 — 최근 정산 건 없음");
            return summary(0, 0, 0, 0, startedAtMillis);
        }

        Map<UUID, GroupChallengeBet> betsById = bets.stream()
                .collect(Collectors.toMap(GroupChallengeBet::getId, Function.identity()));
        List<GroupChallengeBetParticipant> participants =
                groupChallengeBetParticipantRepository.findByBetIdIn(betsById.keySet());
        // 탈퇴 등으로 사라진 유저는 발송 대상이 아니다(참가 행은 정산 이력으로 남는다).
        List<GroupChallengeBetParticipant> targets = participants.stream()
                .filter(participant -> !participant.getUser().isDeleted())
                .toList();
        if (targets.isEmpty()) {
            log.info("내기 결과 푸시 — 발송 대상 없음 (정산 {}건)", bets.size());
            return summary(0, 0, 0, 0, startedAtMillis);
        }

        List<UUID> userIds = targets.stream()
                .map(participant -> participant.getUser().getId())
                .distinct()
                .toList();
        Set<SentKey> alreadySent = alreadySentKeys(userIds, now);
        Map<UUID, UserNotificationSettings> settingsByUserId = loadSettings(userIds);

        int sent = 0;
        int deduped = 0;
        int skipped = 0;
        List<NotificationSentLog> newLogs = new ArrayList<>();
        for (GroupChallengeBetParticipant participant : targets) {
            User user = participant.getUser();
            GroupChallengeBet bet = betsById.get(participant.getBet().getId());
            if (bet == null) {
                // findByBetIdIn 의 입력이 betsById 의 키라 정상 흐름에선 나올 수 없다(방어).
                skipped++;
                continue;
            }
            if (!alreadySent.add(new SentKey(user.getId(), bet.getId()))) {
                deduped++;
                continue;
            }
            UserNotificationSettings settings = settingsByUserId.get(user.getId());
            boolean soundEnabled = settings == null || settings.isSoundEnabled();
            PushMessage message = compose(bet, participant, soundEnabled);
            // 한 건의 실패가 배치를 끊지 않게 격리 — sendIfAllowed 안에서도 잡지만, 문구 조립·로그
            // 조립까지 포함해 건별로 감싼다.
            try {
                if (pushNotificationService.sendIfAllowed(user, settings, message, now)) {
                    sent++;
                    newLogs.add(NotificationSentLog.builder()
                            .userId(user.getId())
                            .type(NotificationSentLog.TYPE_BET_RESULT)
                            .targetUserId(bet.getId())
                            .sentAt(now)
                            .build());
                } else {
                    skipped++;
                }
            } catch (RuntimeException e) {
                skipped++;
                log.warn("내기 결과 푸시 실패 — userId={}, betId={}", user.getId(), bet.getId(), e);
            }
        }
        notificationSentLogRepository.saveAll(newLogs);

        PushDispatchSummaryResponse summary =
                summary(targets.size(), sent, deduped, skipped, startedAtMillis);
        log.info("내기 결과 푸시 완료 — 정산 {}건, 대상 {}건, 발송 {}건, dedup {}건, 스킵 {}건, elapsedMillis={}",
                bets.size(), summary.targetCount(), summary.sentCount(), summary.dedupedCount(),
                summary.skippedCount(), summary.elapsedMillis());
        return summary;
    }

    /**
     * 이미 보낸 (유저, 내기) 조합. 기존 인덱스(user_id, type, sent_at)를 타도록 유저 집합 + 구간으로
     * 조회하고 target_user_id 는 메모리에서 접는다 — target_user_id 단독 조회는 인덱스가 없다.
     */
    private Set<SentKey> alreadySentKeys(List<UUID> userIds, Instant now) {
        return notificationSentLogRepository.findByTypeAndUserIdInSince(
                        NotificationSentLog.TYPE_BET_RESULT, userIds, now.minus(SENT_LOG_LOOKBACK))
                .stream()
                .filter(sentLog -> sentLog.getTargetUserId() != null)
                .map(sentLog -> new SentKey(sentLog.getUserId(), sentLog.getTargetUserId()))
                .collect(Collectors.toCollection(HashSet::new));
    }

    private Map<UUID, UserNotificationSettings> loadSettings(List<UUID> userIds) {
        return userNotificationSettingsRepository.findAllById(userIds).stream()
                .collect(Collectors.toMap(UserNotificationSettings::getUserId, Function.identity()));
    }

    /**
     * 문구 3종(계약 §2 "푸시 (B4)") — 몰수는 내기 상태로, 승패는 참가자의 정산 기록으로 가른다.
     * {@code payout} 은 "받은 금액" 이라 본전(전원 달성)도 승 문구가 나간다 — 손익 환산은 앱 몫이다.
     */
    PushMessage compose(GroupChallengeBet bet, GroupChallengeBetParticipant participant,
                        boolean soundEnabled) {
        String body;
        if (bet.getStatus() == GroupBetStatus.FORFEITED) {
            body = "아무도 목표를 달성하지 못해 판돈이 소멸됐어요";
        } else if (Boolean.TRUE.equals(participant.getAchieved())) {
            int payout = participant.getPayout() == null ? 0 : participant.getPayout();
            body = "내기에서 이겼어요! +" + payout + "코인 🎉";
        } else {
            body = "아쉬워요 — 목표 미달성으로 판돈 " + bet.getStake() + "코인을 잃었어요";
        }
        UUID groupId = bet.getGroup().getId();
        return new PushMessage(
                "내기 결과가 나왔어요",
                body,
                GROUP_DEEP_LINK_PREFIX + groupId,
                soundEnabled,
                Map.of("type", PUSH_TYPE, "groupId", groupId.toString()));
    }

    private PushDispatchSummaryResponse summary(
            int targetCount, int sent, int deduped, int skipped, long startedAtMillis) {
        return new PushDispatchSummaryResponse(
                targetCount, sent, deduped, skipped, System.currentTimeMillis() - startedAtMillis);
    }

    /** dedup 키 — (유저, 내기). 같은 배치 안에서 같은 조합이 두 번 나와도 add 가 false 를 돌려준다. */
    private record SentKey(UUID userId, UUID betId) {
    }
}
