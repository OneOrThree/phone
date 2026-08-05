package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.event.GroupChallengeCreatedEvent;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupChallengeWindowRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.service.WindowFocusAggregator;
import com.oneorthree.phone.notification.domain.NotificationSentLog;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 새 챌린지 등록 알림(GROMO-1089) — 그룹에 챌린지가 열리면 <b>개설자를 뺀 그룹원</b>에게 푸시한다.
 *
 * <p>그룹원은 앱에 들어와야 새 챌린지를 알게 되므로 개설 사실을 먼저 알려 참여를 유도한다.
 * 문구에는 그룹명과 챌린지 목표를 함께 싣는다 — "무슨 챌린지인지" 를 열어보기 전에 알 수 있어야
 * 참여 판단이 선다.
 *
 * <p><b>크론이 아니라 이벤트</b>다. 창 종료(CHALLENGE_WINDOW_END)·내기 정산(BET_RESULT)은 "시간이
 * 지나서" 발생하지만 개설은 유저 행위라 즉시성이 중요하다. 다만 생성 트랜잭션이 롤백됐는데 알림만
 * 나가면 안 되므로 커밋 이후에 받는다 — 그 배선(커밋 이후·비동기)은
 * {@code notification.listener.ChallengeCreatedNotificationListener} 가 갖는다.
 *
 * <p>dedup: (user_id, type={@code CHALLENGE_CREATED}, target_user_id={@code challengeId}).
 * 개설은 1회성이라 정상 흐름에서는 중복이 없고, 이벤트 재발행·재시도에 대한 안전망이다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ChallengeCreatedNotificationService {

    /** 결과가 아직 없으므로 그룹 화면까지만 보낸다 — 계약 §2 (challenge 파라미터를 붙이지 않는다). */
    static final String GROUP_DEEP_LINK_PREFIX = "gromo://group?g=";

    /** 앱이 {@code data.type} 으로 읽어 라우팅·GA4 {@code push_opened} 에 쓴다(계약 §2). */
    static final String PUSH_TYPE = NotificationSentLog.TYPE_CHALLENGE_CREATED;

    /**
     * dedup 조회 하한을 챌린지 생성 시각보다 이만큼 앞당긴다.
     *
     * <p>정확한 하한은 챌린지 생성 시각이다 — 이 챌린지의 발송 로그는 챌린지보다 먼저 생길 수 없다.
     * 이 여유분은 <b>순수한 방어값</b>이다. 지금은 커밋한 인스턴스가 그대로 발송해 생성 시각
     * ({@code @CreationTimestamp})과 발송 시각이 같은 JVM 시계에서 찍히지만, 나중에 재시도·백필이
     * 다른 인스턴스에서 돌면 미세한 시계 차로 하한이 어긋날 수 있다. 조회 결과는 어차피
     * {@code target_user_id} 로 한 번 더 거르므로 하한을 넓혀도 오탐은 없고 스캔 범위만 조금 는다
     * (@claude 리뷰 — 원래 주석이 다중 인스턴스를 현재 동작인 양 적어 두어 근거를 바로잡았다).
     */
    static final Duration DEDUP_LOOKBACK_MARGIN = Duration.ofMinutes(5);

    private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");

    private final GroupChallengeRepository groupChallengeRepository;
    private final GroupChallengeDurationRepository groupChallengeDurationRepository;
    private final GroupChallengeWindowRepository groupChallengeWindowRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final UserNotificationSettingsRepository userNotificationSettingsRepository;
    private final NotificationSentLogRepository notificationSentLogRepository;
    private final PushNotificationService pushNotificationService;

    /**
     * 발송 본체. 진입점(커밋 이후·비동기)은 {@code ChallengeCreatedNotificationListener} 가 맡는다.
     *
     * <p>{@link Propagation#REQUIRES_NEW} — 무효 토큰 정리(더티체킹)와 발송 로그 저장에 쓰기
     * 트랜잭션이 필요한데, 이 메서드는 원 트랜잭션이 <b>커밋을 마친 뒤</b> 불린다. 비동기 경계를
     * 넘어 별도 스레드에서 도는 것이 정상 경로라 이미 열린 트랜잭션이 없지만, 혹시 커밋 스레드에서
     * 그대로 불리더라도 종료 중인 트랜잭션에 합류해 쓰기가 조용히 사라지지 않도록 새로 연다.
     *
     * @return 실제 발송된 건수
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public int sendCreatedNotifications(GroupChallengeCreatedEvent event, Instant now) {
        GroupChallenge challenge = groupChallengeRepository.findById(event.challengeId()).orElse(null);
        if (challenge == null || challenge.getDeletedAt() != null) {
            // 커밋 직후 곧바로 삭제된 경우 — 없는 챌린지를 알리지 않는다.
            log.info("챌린지 개설 푸시 스킵 — 챌린지 없음/삭제됨 challengeId={}", event.challengeId());
            return 0;
        }

        List<User> recipients = groupMemberRepository.findByGroup(challenge.getGroup()).stream()
                .map(GroupMember::getUser)
                .filter(user -> !user.isDeleted())
                .filter(user -> !user.getId().equals(event.creatorUserId()))
                .toList();
        if (recipients.isEmpty()) {
            return 0;
        }

        List<UUID> userIds = recipients.stream().map(User::getId).toList();
        Set<UUID> alreadySentUserIds = alreadySentUserIds(challenge, userIds);
        Map<UUID, UserNotificationSettings> settingsByUserId = loadSettings(userIds);
        String missionLabel = missionLabel(challenge);

        return sendToMembers(challenge, recipients, alreadySentUserIds, settingsByUserId, missionLabel, now);
    }

    private int sendToMembers(GroupChallenge challenge, List<User> recipients,
            Set<UUID> alreadySentUserIds, Map<UUID, UserNotificationSettings> settingsByUserId,
            String missionLabel, Instant now) {
        int sent = 0;
        int deduped = 0;
        int skipped = 0;
        List<NotificationSentLog> newLogs = new ArrayList<>();
        for (User user : recipients) {
            if (!alreadySentUserIds.add(user.getId())) {
                deduped++;
                continue;
            }
            UserNotificationSettings settings = settingsByUserId.get(user.getId());
            boolean soundEnabled = settings == null || settings.isSoundEnabled();
            try {
                // 알림 off·토큰 없음·야간 모드는 sendIfAllowed 가 걸러 false 를 돌려준다.
                if (pushNotificationService.sendIfAllowed(
                        user, settings, compose(challenge, missionLabel, soundEnabled), now)) {
                    sent++;
                    newLogs.add(NotificationSentLog.builder()
                            .userId(user.getId())
                            .type(NotificationSentLog.TYPE_CHALLENGE_CREATED)
                            .targetUserId(challenge.getId())
                            .sentAt(now)
                            .build());
                } else {
                    skipped++;
                }
            } catch (RuntimeException e) {
                // 한 명의 실패가 나머지 그룹원 발송을 막지 않게 유저 단위로 격리한다.
                skipped++;
                log.warn("챌린지 개설 푸시 실패 — userId={}, challengeId={}",
                        user.getId(), challenge.getId(), e);
            }
        }
        notificationSentLogRepository.saveAll(newLogs);

        log.info("챌린지 개설 푸시 완료 — challengeId={}, 대상 {}건, 발송 {}건, dedup {}건, 스킵 {}건",
                challenge.getId(), recipients.size(), sent, deduped, skipped);
        return sent;
    }

    /**
     * 이미 이 챌린지의 개설 알림을 받은 유저. 기존 인덱스 (user_id, type, sent_at) 를 타도록
     * 유저 집합 + 하한 시각으로 조회하고 target_user_id 는 메모리에서 접는다(창 종료 알림과 동일 관행).
     * 하한은 챌린지 생성 시각 — 이 챌린지의 발송 로그는 그보다 앞설 수 없다.
     */
    private Set<UUID> alreadySentUserIds(GroupChallenge challenge, List<UUID> userIds) {
        Instant since = challenge.getCreatedAt().minus(DEDUP_LOOKBACK_MARGIN);
        return notificationSentLogRepository.findByTypeAndUserIdInSince(
                        NotificationSentLog.TYPE_CHALLENGE_CREATED, userIds, since)
                .stream()
                .filter(sentLog -> challenge.getId().equals(sentLog.getTargetUserId()))
                .map(NotificationSentLog::getUserId)
                .collect(Collectors.toCollection(HashSet::new));
    }

    private Map<UUID, UserNotificationSettings> loadSettings(List<UUID> userIds) {
        return userNotificationSettingsRepository.findAllById(userIds).stream()
                .collect(Collectors.toMap(UserNotificationSettings::getUserId, Function.identity()));
    }

    /** 그룹명은 제목에, 목표는 본문에 — 알림 목록에서 접혀도 어느 그룹인지가 먼저 보인다. */
    PushMessage compose(GroupChallenge challenge, String missionLabel, boolean soundEnabled) {
        UUID groupId = challenge.getGroup().getId();
        return new PushMessage(
                challenge.getGroup().getName() + "에 새 챌린지가 열렸어요",
                missionLabel + " — 지금 참여해보세요",
                GROUP_DEEP_LINK_PREFIX + groupId,
                soundEnabled,
                Map.of("type", PUSH_TYPE, "groupId", groupId.toString()));
    }

    /**
     * 챌린지 목표 한 줄 요약 — 앱의 {@code missionLabel}(챌린지 카드·내기 시트)과 같은 문장을 만든다.
     * 알림을 보고 들어온 화면의 문구와 어긋나면 같은 챌린지가 달라 보인다.
     *
     * <p>CTI 상세 행이 없거나(있을 수 없지만 방어) 창형인데 목표분이 비어 있으면(V20 이전 데이터)
     * 목표를 지어내지 않고 카테고리 명사로 떨어뜨린다.
     */
    String missionLabel(GroupChallenge challenge) {
        String what = challenge.getCategory() == MissionCategory.SCREEN_TIME ? "스크린타임" : "집중";
        if (challenge.getType() == MissionType.DURATION) {
            Integer minutes = groupChallengeDurationRepository
                    .findByChallengeIdIn(List.of(challenge.getId())).stream()
                    .findFirst()
                    .map(GroupChallengeDuration::getDurationMinutes)
                    .orElse(null);
            return minutes != null ? "하루 " + minutes + "분 " + what : categoryLabel(challenge);
        }
        Optional<GroupChallengeWindow> window = groupChallengeWindowRepository
                .findByChallengeIdIn(List.of(challenge.getId())).stream()
                .findFirst();
        if (window.isEmpty()) {
            return categoryLabel(challenge);
        }
        String span = "매일 " + hhmm(window.get().getWindowStartAt())
                + "~" + hhmm(window.get().getWindowEndAt()) + " ";
        Integer goal = window.get().getDurationMinutes();
        return goal != null ? span + goal + "분 " + what : span + what;
    }

    /** 목표를 못 만든 챌린지의 폴백 — 앱의 {@code categoryLabel} 과 같은 명칭. */
    private static String categoryLabel(GroupChallenge challenge) {
        return challenge.getCategory() == MissionCategory.SCREEN_TIME ? "스크린타임" : "집중 시간";
    }

    /**
     * 창 시각 표기 — 저장된 Instant 에서 시각(time-of-day)만 뽑는다. 추출 기준은
     * {@link WindowFocusAggregator#timeOfDay} 단일 소스를 공유한다(생성 검증·집계·응답 변환과 동일).
     */
    private static String hhmm(Instant instant) {
        LocalTime time = WindowFocusAggregator.timeOfDay(instant);
        return time.format(HH_MM);
    }
}
