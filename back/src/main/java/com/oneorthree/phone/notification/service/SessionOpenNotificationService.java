package com.oneorthree.phone.notification.service;

import com.fasterxml.uuid.Generators;
import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.notification.domain.NotificationSendStatus;
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
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 회차 <b>참여 모집</b> 알림 (GROMO-1417 · 1282, N40·N20·N44) — 아직 참가할 수 있는 회차를
 * 그룹원에게 알린다. 발송 슬롯이 회차 유형으로 갈린다:
 *
 * <ul>
 *   <li><b>창형</b>: 참가 마감(= 창 시작) <b>−30분</b>. 아직 들어올 수 있는 마지막 알림 시점이다.</li>
 *   <li><b>하루형</b>: <b>당일 08:00 KST</b>(N40). 하루형의 시작−30분은 전날 23:30 이라 회차 미생성
 *       (00:05 개설)과 조용한 시간(23–07)에 <b>이중으로 막혀 영영 못 나간다</b> — 조용한 시간 직후
 *       아침 슬롯으로 옮긴다. 하루형은 종일 참가라 "마지막"이 아니라 "시작" 리마인더다.</li>
 * </ul>
 *
 * <p><b>조용한 시간이면 이월하지 않고 버린다</b>(N44 단서) — 결과·환불과 달리 모집은 07:00 에
 * 도착해봐야 참가 마감이 지나 "참여하세요"가 거짓말이 된다. 창이 07:30 이전에 시작하는 챌린지는
 * 모집 알림 없이 돈다(수용 — HLD §6 시각 선정 근거).
 *
 * <p>dedup·묶음 규율은 결과 알림과 같다(N41·N20): 클레임은 사건마다
 * {@code (user, CHALLENGE_SESSION_OPEN, 회차 id)}, 푸시는 (유저 × 그룹 × 슬롯)마다 한 건이고
 * 묶음 payload 엔 특정 {@code challengeId} 를 싣지 않는다(IA §4.2).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SessionOpenNotificationService {

    /** 창형 모집 알림 선행 시간 — 참가 마감(창 시작) 30분 전. */
    static final Duration WINDOW_LEAD = Duration.ofMinutes(30);

    /** 하루형 모집 알림 슬롯(N40) — 회차일 08:00 KST. */
    static final LocalTime DURATION_SLOT_TIME = LocalTime.of(8, 0);

    /**
     * 후보 조회 상한 — 참가 마감이 지금부터 이 시간 안인 회차만 본다. 창형 30분 선행에 크론
     * 주기(15분)와 지연 여유를 더한 폭이면 충분하고, 주간 예약분(join-week)이 매 틱 끌려오지 않는다.
     * 하루형은 참가 마감이 자정이라 08:00 슬롯 시점에서 16시간 남아 이 창에 들어온다.
     */
    static final Duration LOOKAHEAD = Duration.ofHours(20);

    /** 모집 알림이 유효한 뒤늦음 한계 — 슬롯을 이만큼 넘겼으면 보내지 않는다(크론 지연·재기동 대비). */
    private static final Duration SLOT_GRACE = Duration.ofHours(2);

    private static final Duration SLOT_WIDTH = Duration.ofMinutes(15);

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    private final GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final UserNotificationSettingsRepository userNotificationSettingsRepository;
    private final NotificationSentLogRepository notificationSentLogRepository;
    private final PushNotificationService pushNotificationService;

    /** 소유한 클레임 1건 — 행 id 와 그 사건의 회차. */
    private record Claim(UUID rowId, UUID userId, GroupChallengeBetSession session) {
    }

    /** 묶음 키 — (유저 × 그룹 × 슬롯). */
    private record BundleKey(UUID userId, UUID groupId, Instant slotAt) {
    }

    /** 스케줄러(15분)·수동 트리거 진입점. */
    @Transactional
    public PushDispatchSummaryResponse sendSessionOpenNotifications() {
        return sendSessionOpenNotifications(Instant.now());
    }

    /** 모집 슬롯에 도달한 회차 스캔 → 미참가 그룹원 클레임 → 묶음 발송. */
    @Transactional
    public PushDispatchSummaryResponse sendSessionOpenNotifications(Instant now) {
        long startedAtMillis = System.currentTimeMillis();
        List<GroupChallengeBetSession> due =
                groupChallengeBetSessionRepository.findOpenJoinableSessions(now, now.plus(LOOKAHEAD))
                        .stream()
                        .filter(session -> isSlotReached(session, now))
                        .toList();
        if (due.isEmpty()) {
            return summary(0, 0, 0, 0, startedAtMillis);
        }

        Set<UUID> sessionIds = due.stream()
                .map(GroupChallengeBetSession::getId)
                .collect(Collectors.toCollection(HashSet::new));
        // 이미 참가한 사람은 모집 대상이 아니다 — (회차, 유저) 조합으로 접는다.
        Set<String> joined = groupChallengeBetParticipantRepository.findBySessionIdIn(sessionIds).stream()
                .map(p -> p.getSession().getId() + ":" + p.getUser().getId())
                .collect(Collectors.toCollection(HashSet::new));
        Set<UUID> groupIds = due.stream()
                .map(session -> session.getGroup().getId())
                .collect(Collectors.toCollection(HashSet::new));
        Map<UUID, List<User>> membersByGroupId = groupMemberRepository.findByGroupIdIn(groupIds).stream()
                .filter(member -> !member.getUser().isDeleted())
                .collect(Collectors.groupingBy(member -> member.getGroup().getId(),
                        Collectors.mapping(GroupMember::getUser, Collectors.toList())));

        int targets = 0;
        int deduped = 0;
        List<Claim> owned = new ArrayList<>();
        for (GroupChallengeBetSession session : due) {
            Instant slotAt = slotOf(slotStartOf(session));
            for (User member : membersByGroupId.getOrDefault(session.getGroup().getId(), List.of())) {
                if (joined.contains(session.getId() + ":" + member.getId())) {
                    continue;
                }
                targets++;
                UUID rowId = Generators.timeBasedEpochRandomGenerator().generate();
                int claimed = notificationSentLogRepository.insertPendingClaim(rowId, member.getId(),
                        NotificationSentLog.TYPE_CHALLENGE_SESSION_OPEN, session.getId(),
                        session.getGroup().getId(), slotAt, now);
                if (claimed == 0) {
                    deduped++;
                    continue;
                }
                owned.add(new Claim(rowId, member.getId(), session));
            }
        }
        int sent = sendBundles(owned, membersByGroupId, now);
        PushDispatchSummaryResponse summary =
                summary(targets, sent, deduped, targets - sent - deduped, startedAtMillis);
        if (targets > 0) {
            log.info("회차 모집 푸시 — 슬롯 도달 회차 {}건, 대상 {}건, 발송 {}건, dedup {}건, 스킵 {}건",
                    due.size(), summary.targetCount(), summary.sentCount(),
                    summary.dedupedCount(), summary.skippedCount());
        }
        return summary;
    }

    /**
     * 발송 슬롯 시각 — 창형은 참가 마감 −30분, 하루형은 회차일 08:00 KST(N40).
     * 하루형의 회차일은 스냅샷 {@code sessionDate} 그대로다(자정 경계 = 회차 경계).
     */
    static Instant slotStartOf(GroupChallengeBetSession session) {
        if (session.getMissionType() == MissionType.TIME_WINDOW) {
            return session.getJoinClosesAt().minus(WINDOW_LEAD);
        }
        return session.getSessionDate().atTime(DURATION_SLOT_TIME).atZone(KST).toInstant();
    }

    /** 슬롯에 도달했고 아직 유효한가 — 너무 이르면 다음 틱, 2시간 넘게 늦었으면 포기한다. */
    private static boolean isSlotReached(GroupChallengeBetSession session, Instant now) {
        Instant slot = slotStartOf(session);
        return !now.isBefore(slot) && now.isBefore(slot.plus(SLOT_GRACE));
    }

    /** 사건 시각 → 묶음 슬롯(15분 경계 내림) — 결과 알림과 같은 규칙. */
    private static Instant slotOf(Instant eventAt) {
        long slotMillis = SLOT_WIDTH.toMillis();
        return Instant.ofEpochMilli(Math.floorDiv(eventAt.toEpochMilli(), slotMillis) * slotMillis);
    }

    /**
     * 묶음 발송 — (유저 × 그룹 × 슬롯) 한 건. 조용한 시간이면 <b>클레임을 지워 버린다</b>
     * (N44 단서 — 모집은 이월 대상이 아니다. 지우는 이유는 다음 활성일의 같은 회차가 아니라
     * 남은 슬롯 안에서의 재시도를 열어 두기 위함이다).
     */
    private int sendBundles(List<Claim> owned, Map<UUID, List<User>> membersByGroupId, Instant now) {
        if (owned.isEmpty()) {
            return 0;
        }
        Map<UUID, User> usersById = membersByGroupId.values().stream()
                .flatMap(List::stream)
                .collect(Collectors.toMap(User::getId, Function.identity(), (a, b) -> a));
        Map<BundleKey, List<Claim>> bundles = new LinkedHashMap<>();
        for (Claim claim : owned) {
            BundleKey key = new BundleKey(claim.userId(), claim.session().getGroup().getId(),
                    slotOf(slotStartOf(claim.session())));
            bundles.computeIfAbsent(key, k -> new ArrayList<>()).add(claim);
        }
        List<UUID> userIds = bundles.keySet().stream().map(BundleKey::userId).distinct().toList();
        Map<UUID, UserNotificationSettings> settingsByUserId =
                userNotificationSettingsRepository.findAllById(userIds).stream()
                        .collect(Collectors.toMap(
                                UserNotificationSettings::getUserId, Function.identity()));

        int sent = 0;
        for (Map.Entry<BundleKey, List<Claim>> entry : bundles.entrySet()) {
            List<Claim> claims = entry.getValue();
            List<UUID> rowIds = claims.stream().map(Claim::rowId).toList();
            User user = usersById.get(entry.getKey().userId());
            UserNotificationSettings settings = settingsByUserId.get(entry.getKey().userId());
            if (user == null || PushNotificationService.isQuietHours(settings, now)) {
                notificationSentLogRepository.deleteByIds(rowIds);
                continue;
            }
            boolean soundEnabled = settings == null || settings.isSoundEnabled();
            try {
                if (pushNotificationService.sendIfAllowed(user, settings,
                        compose(claims, soundEnabled), now)) {
                    notificationSentLogRepository.updateStatusByIds(
                            rowIds, NotificationSendStatus.SENT, now);
                    sent += claims.size();
                } else {
                    notificationSentLogRepository.deleteByIds(rowIds);
                }
            } catch (RuntimeException e) {
                notificationSentLogRepository.deleteByIds(rowIds);
                log.warn("회차 모집 푸시 실패 — userId={}, 사건 {}건", entry.getKey().userId(),
                        claims.size(), e);
            }
        }
        return sent;
    }

    /** 문구·payload — 묶음(다건)은 challengeId 를 싣지 않는다(IA §4.2). 딥링크는 앱이 groupId 로 합성. */
    PushMessage compose(List<Claim> claims, boolean soundEnabled) {
        UUID groupId = claims.get(0).session().getGroup().getId();
        Map<String, String> data = new LinkedHashMap<>();
        data.put("type", NotificationSentLog.TYPE_CHALLENGE_SESSION_OPEN);
        data.put("groupId", groupId.toString());
        if (claims.size() == 1) {
            GroupChallengeBetSession session = claims.get(0).session();
            data.put("challengeId", session.getChallenge().getId().toString());
            return new PushMessage("오늘 참여할 챌린지가 있어요",
                    "참가비 " + session.getStake() + "코인 — 지금 참여할 수 있어요",
                    null, soundEnabled, data);
        }
        return new PushMessage("오늘 참여할 챌린지가 있어요",
                "참여 가능한 챌린지 " + claims.size() + "개가 열려 있어요",
                null, soundEnabled, data);
    }

    private PushDispatchSummaryResponse summary(
            int targetCount, int sent, int deduped, int skipped, long startedAtMillis) {
        return new PushDispatchSummaryResponse(
                targetCount, sent, deduped, skipped, System.currentTimeMillis() - startedAtMillis);
    }
}
