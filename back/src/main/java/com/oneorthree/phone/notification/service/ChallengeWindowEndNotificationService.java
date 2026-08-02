package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupChallengeWindowRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.service.WindowFocusAggregator;
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
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 스크린타임 창형(SCREEN_TIME × TIME_WINDOW) 챌린지의 <b>창 종료 감지 푸시</b>(B4) — 15분 크론.
 *
 * <p>창형 스크린타임은 "창이 끝난 뒤 유저가 앱에 들어와야" 사용분이 올라온다(A4 업로드). 그래서 창이
 * 끝난 직후 "결과를 확인해보세요" 를 보내 복귀를 유도하고, 복귀가 업로드 → 결과 모달로 이어진다.
 * <b>승패는 싣지 않는다</b> — 보고 전이라 아직 확정이 아니다.
 *
 * <p>창은 매일 반복되는 시간대다(계약 §설계 보정). 날짜 D 의 실제 창 경계는
 * {@link WindowFocusAggregator#windowEndOn} 이 유일한 소스이며(진행률·정산과 같은 해석),
 * 자정을 걸치는 창은 D 시작 ~ D+1 종료로 전개된다. 그래서 감지 후보 날짜를 어제·오늘 둘로 잡는다.
 *
 * <p>dedup: (user_id, type={@code CHALLENGE_WINDOW_END}, target_user_id={@code challengeId}) +
 * <b>당일(KST) sent_at</b>. 매일 반복되는 창이라 날짜를 끊지 않으면 이튿날 발송까지 막힌다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ChallengeWindowEndNotificationService {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    /** 결과 확인 딥링크 — 앱(A3)이 그룹 화면으로 이동시키고, 그 진입이 창 사용분 업로드를 트리거한다. */
    static final String GROUP_DEEP_LINK_PREFIX = "gromo://group?g=";

    /** 푸시 종류 식별자 — 앱이 data.type 으로 읽어 딥링크 합성·GA4 push_opened 에 쓴다(계약 §2). */
    static final String PUSH_TYPE = NotificationSentLog.TYPE_CHALLENGE_WINDOW_END;

    /**
     * "방금 끝났다" 로 보는 폭 — 크론 주기(15분)보다 넉넉하게 잡는다. 배포·재기동으로 한 틱을 걸러도
     * 다음 틱이 주워 담게 하려는 것이고, 넓혀서 생기는 중복 발송은 dedup 이 막는다(늦어도 30분 내 발송).
     */
    static final Duration RECENTLY_ENDED_WINDOW = Duration.ofMinutes(30);

    private final GroupChallengeRepository groupChallengeRepository;
    private final GroupChallengeWindowRepository groupChallengeWindowRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final UserNotificationSettingsRepository userNotificationSettingsRepository;
    private final NotificationSentLogRepository notificationSentLogRepository;
    private final PushNotificationService pushNotificationService;
    private final WindowFocusAggregator windowFocusAggregator;

    /** 스케줄러(15분 간격)·수동 트리거 진입점. */
    public PushDispatchSummaryResponse sendWindowEndNotifications() {
        return sendWindowEndNotifications(Instant.now());
    }

    /**
     * 창 종료 감지 푸시 본체.
     *
     * <p>무효 토큰 정리(더티체킹)가 일어나므로 쓰기 트랜잭션 안에서 돈다.
     */
    @Transactional
    public PushDispatchSummaryResponse sendWindowEndNotifications(Instant now) {
        long startedAtMillis = System.currentTimeMillis();
        List<GroupChallenge> challenges = groupChallengeRepository.findActiveByCategoryAndType(
                GroupChallengeStatus.ACTIVE, MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW);
        if (challenges.isEmpty()) {
            return summary(0, 0, 0, 0, startedAtMillis);
        }

        Map<UUID, GroupChallengeWindow> windowsByChallengeId = groupChallengeWindowRepository
                .findByChallengeIdIn(challenges.stream().map(GroupChallenge::getId).toList())
                .stream()
                .collect(Collectors.toMap(GroupChallengeWindow::getChallengeId, Function.identity()));
        List<GroupChallenge> justEnded = challenges.stream()
                .filter(challenge -> hasJustEnded(windowsByChallengeId.get(challenge.getId()), now))
                .toList();
        if (justEnded.isEmpty()) {
            return summary(0, 0, 0, 0, startedAtMillis);
        }

        int target = 0;
        int sent = 0;
        int deduped = 0;
        int skipped = 0;
        List<NotificationSentLog> newLogs = new ArrayList<>();
        for (GroupChallenge challenge : justEnded) {
            // 그룹 단위 처리 — 방금 창이 끝난 챌린지만 남았으므로 여기 도는 그룹 수는 보통 0~소수다.
            List<User> members = groupMemberRepository.findByGroup(challenge.getGroup()).stream()
                    .map(GroupMember::getUser)
                    .filter(user -> !user.isDeleted())
                    .toList();
            if (members.isEmpty()) {
                continue;
            }
            List<UUID> userIds = members.stream().map(User::getId).toList();
            Set<UUID> alreadySentUserIds = alreadySentUserIds(challenge.getId(), userIds, now);
            Map<UUID, UserNotificationSettings> settingsByUserId = loadSettings(userIds);
            for (User user : members) {
                target++;
                if (!alreadySentUserIds.add(user.getId())) {
                    deduped++;
                    continue;
                }
                UserNotificationSettings settings = settingsByUserId.get(user.getId());
                boolean soundEnabled = settings == null || settings.isSoundEnabled();
                try {
                    if (pushNotificationService.sendIfAllowed(
                            user, settings, compose(challenge, soundEnabled), now)) {
                        sent++;
                        newLogs.add(NotificationSentLog.builder()
                                .userId(user.getId())
                                .type(NotificationSentLog.TYPE_CHALLENGE_WINDOW_END)
                                .targetUserId(challenge.getId())
                                .sentAt(now)
                                .build());
                    } else {
                        skipped++;
                    }
                } catch (RuntimeException e) {
                    skipped++;
                    log.warn("창 종료 푸시 실패 — userId={}, challengeId={}",
                            user.getId(), challenge.getId(), e);
                }
            }
        }
        notificationSentLogRepository.saveAll(newLogs);

        PushDispatchSummaryResponse summary = summary(target, sent, deduped, skipped, startedAtMillis);
        log.info("창 종료 푸시 완료 — 종료 챌린지 {}건, 대상 {}건, 발송 {}건, dedup {}건, 스킵 {}건, "
                        + "elapsedMillis={}",
                justEnded.size(), summary.targetCount(), summary.sentCount(), summary.dedupedCount(),
                summary.skippedCount(), summary.elapsedMillis());
        return summary;
    }

    /**
     * 오늘(KST) 창 종료가 방금 지났는지. 자정을 걸치는 창은 어제 시작분의 종료가 오늘 새벽이므로
     * 어제·오늘 두 날짜를 모두 후보로 본다. 경계는 {@code (now - 폭, now]} — 종료 시각 정각은 포함이다.
     */
    private boolean hasJustEnded(GroupChallengeWindow window, Instant now) {
        if (window == null) {
            // V20 이전 창 챌린지에도 상세 행은 있으므로 정상 흐름에선 나오지 않는다(방어).
            return false;
        }
        LocalDate today = LocalDate.ofInstant(now, KST);
        Instant since = now.minus(RECENTLY_ENDED_WINDOW);
        return List.of(today.minusDays(1), today).stream()
                .map(date -> windowFocusAggregator.windowEndOn(date, window))
                .anyMatch(end -> end.isAfter(since) && !end.isAfter(now));
    }

    /**
     * 오늘(KST) 이미 이 챌린지의 창 종료 푸시를 받은 유저. 기존 인덱스(user_id, type, sent_at)를 타도록
     * 유저 집합 + 당일 구간으로 조회하고 target_user_id 는 메모리에서 접는다.
     */
    private Set<UUID> alreadySentUserIds(UUID challengeId, List<UUID> userIds, Instant now) {
        Instant startOfTodayKst = LocalDate.ofInstant(now, KST).atStartOfDay(KST).toInstant();
        return notificationSentLogRepository.findByTypeAndUserIdInSince(
                        NotificationSentLog.TYPE_CHALLENGE_WINDOW_END, userIds, startOfTodayKst)
                .stream()
                .filter(sentLog -> challengeId.equals(sentLog.getTargetUserId()))
                .map(NotificationSentLog::getUserId)
                .collect(Collectors.toCollection(HashSet::new));
    }

    private Map<UUID, UserNotificationSettings> loadSettings(List<UUID> userIds) {
        return userNotificationSettingsRepository.findAllById(userIds).stream()
                .collect(Collectors.toMap(UserNotificationSettings::getUserId, Function.identity()));
    }

    /** 승패 미포함 문구(계약 §2) — 보고 전이라 결과가 확정되지 않았다. */
    PushMessage compose(GroupChallenge challenge, boolean soundEnabled) {
        UUID groupId = challenge.getGroup().getId();
        return new PushMessage(
                "챌린지가 끝났어요!",
                "결과를 확인해보세요",
                GROUP_DEEP_LINK_PREFIX + groupId,
                soundEnabled,
                Map.of("type", PUSH_TYPE, "groupId", groupId.toString()));
    }

    private PushDispatchSummaryResponse summary(
            int targetCount, int sent, int deduped, int skipped, long startedAtMillis) {
        return new PushDispatchSummaryResponse(
                targetCount, sent, deduped, skipped, System.currentTimeMillis() - startedAtMillis);
    }
}
