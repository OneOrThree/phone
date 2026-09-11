package com.oneorthree.phone.notification.service;

import com.fasterxml.uuid.Generators;
import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.MissionType;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.notification.producer.NotificationDispatchOutcome;
import com.oneorthree.phone.notification.producer.NotificationDispatcher;
import com.oneorthree.phone.notification.producer.NotificationKind;
import com.oneorthree.phone.notification.producer.NotificationRequest;
import com.oneorthree.phone.notification.repository.domain.NotificationSendStatus;
import com.oneorthree.phone.notification.repository.domain.NotificationSentLog;
import com.oneorthree.phone.notification.dto.PushDispatchSummaryResponse;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserQueryService;
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
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
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
 * <p><b>조용한 시간이면 참가 마감과 대조해 가른다</b>(N44 + 그 단서). 조용한 시간은 유저 설정
 * ({@code nightStartTime}·{@code nightEndTime})이라 임의의 {@code HH:mm} 이고, 종료 시각이 곧
 * 참가 마감인 것도 아니다:
 * <ul>
 *   <li><b>종료 시점에 이미 마감</b> → {@code SENT} 로 <b>종결</b>한다. 이월해봐야 "참여하세요"가
 *       거짓말이 된다(N44 단서). 창 시작이 조용한 시간 종료보다 이른 챌린지는 모집 알림 없이
 *       돈다(수용 — HLD §6 시각 선정 근거).</li>
 *   <li><b>종료 시점에도 참가 가능</b> → {@code DEFERRED} 로 <b>이월</b>하고 다음 시도 시각에
 *       그 유저의 조용한 시간 종료를 박는다(N44 본문). 여기서 종결해 버리면 야간을 09:00 까지로
 *       둔 유저의 하루형 08:00 모집(마감은 자정)이 <b>영구히 발송되지 않는다</b>.</li>
 * </ul>
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

    /** 이 서비스가 소유한 kind — 이월 flush 가 다른 트리거의 클레임을 훔치지 않게 한다. */
    private static final List<String> OWNED_KINDS =
            List.of(NotificationSentLog.TYPE_CHALLENGE_SESSION_OPEN);

    private final GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    private final GroupQueryService groupQueryService;
    private final GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final NotificationSentLogRepository notificationSentLogRepository;
    private final UserQueryService userQueryService;
    private final PushNotificationService pushNotificationService;
    private final NotificationDispatcher notificationDispatcher;

    /** 소유한 클레임 1건 — 행 id 와 그 사건의 회차·수신자. */
    private record Claim(UUID rowId, User user, GroupChallengeBetSession session) {
    }

    /** 묶음 키 — (유저 × 그룹 × 슬롯). */
    private record BundleKey(UUID userId, UUID groupId, Instant slotAt) {
    }

    /**
     * 스케줄러(15분)·수동 트리거 진입점.
     *
     * @return 이번 실행의 발송 요약(현재 시각 기준)
     */
    @Transactional
    public PushDispatchSummaryResponse sendSessionOpenNotifications() {
        return sendSessionOpenNotifications(Instant.now());
    }

    /**
     * 모집 슬롯에 도달한 회차 스캔 → 미참가 그룹원 클레임 → (이월분 합류) → 묶음 발송.
     *
     * @param now 슬롯 도달 판정과 조용한 시간 판정의 기준 시각. 조용한 시간에 걸린 대상은 버리지 않고
     *            창이 끝나는 시각으로 이월된다
     * @return 이번 실행의 발송 요약. 클레임이 한 틱만 통과하므로 여러 틱에 걸친 회차도 한 번만 발송된다
     */
    @Transactional
    public PushDispatchSummaryResponse sendSessionOpenNotifications(Instant now) {
        long startedAtMillis = System.currentTimeMillis();
        List<GroupChallengeBetSession> due =
                groupChallengeBetSessionRepository.findOpenJoinableSessions(now, now.plus(LOOKAHEAD))
                        .stream()
                        .filter(session -> isSlotReached(session, now))
                        .toList();

        int targets = 0;
        int deduped = 0;
        int queued = 0;
        List<Claim> owned = new ArrayList<>();
        if (!due.isEmpty()) {
            Set<UUID> sessionIds = due.stream()
                    .map(GroupChallengeBetSession::getId)
                    .collect(Collectors.toCollection(HashSet::new));
            // 이미 참가한 사람은 모집 대상이 아니다 — (회차, 유저) 조합으로 접는다.
            // 이 스냅샷은 <스캔 시점>이라 발송 직전에 한 번 더 확인한다({@link #sendBundles}).
            Set<String> joined = groupChallengeBetParticipantRepository.findBySessionIdIn(sessionIds)
                    .stream()
                    .map(p -> joinKey(p.getSession().getId(), p.getUser().getId()))
                    .collect(Collectors.toCollection(HashSet::new));
            Set<UUID> groupIds = due.stream()
                    .map(session -> session.getGroup().getId())
                    .collect(Collectors.toCollection(HashSet::new));
            Map<UUID, List<User>> membersByGroupId =
                    groupMemberRepository.findByGroupIdIn(groupIds).stream()
                            .filter(member -> !member.getUser().isDeleted())
                            .collect(Collectors.groupingBy(member -> member.getGroup().getId(),
                                    Collectors.mapping(GroupMember::getUser, Collectors.toList())));

            // 신 경로는 묶음 구성원을 사건마다 실어 보낸다 — 그래야 첫 사건만 도착한 사이에 flush 가
            // 끼어도 알림 서버가 나머지를 기다려 (유저 × 그룹 × 슬롯) 한 건 보장을 지킨다(종료 알림과
            // 같은 규율). 이 종류의 대상은 «회차»이므로 구성원도 회차 id 집합이다.
            Map<BundleKey, List<String>> bundleMembers = notificationDispatcher.isOutboxMode()
                    ? openBundleMembers(due, joined, membersByGroupId)
                    : Map.of();

            for (GroupChallengeBetSession session : due) {
                Instant slotAt = slotOf(slotStartOf(session));
                for (User member : membersByGroupId.getOrDefault(
                        session.getGroup().getId(), List.of())) {
                    if (joined.contains(joinKey(session.getId(), member.getId()))) {
                        continue;
                    }
                    targets++;
                    if (notificationDispatcher.isOutboxMode()) {
                        // 신 경로: 선점도 묶음도 이월도 여기서 하지 않는다. 후보를 사건으로 적고
                        // claim/render/send/flush 는 알림 서버가 소유한다(계약 §5).
                        // 이월 만료(참가 마감)를 함께 실어 보낸다 — 조용한 시간이 끝났을 때 이미
                        // 마감이면 「참여하세요」가 거짓말이 되므로 그때 버려야 한다(N44 단서).
                        if (notificationDispatcher.enqueueOnly(new NotificationRequest(
                                NotificationKind.CHALLENGE_SESSION_OPEN, member.getId(),
                                session.getId(), session.getGroup().getId(), slotAt, null,
                                member.getLanguage(),
                                Map.of("challengeId", session.getChallenge().getId().toString(),
                                        "stake", session.getStake(),
                                        "deferExpiresAt", session.getJoinClosesAt().toString(),
                                        "bundleMembers", bundleMembers.get(new BundleKey(
                                                member.getId(), session.getGroup().getId(), slotAt)))))
                                == NotificationDispatchOutcome.QUEUED) {
                            queued++;
                        } else {
                            deduped++;
                        }
                        continue;
                    }
                    UUID rowId = Generators.timeBasedEpochRandomGenerator().generate();
                    int claimed = notificationSentLogRepository.insertPendingClaim(rowId,
                            member.getId(), NotificationSentLog.TYPE_CHALLENGE_SESSION_OPEN,
                            session.getId(), session.getGroup().getId(), slotAt, now);
                    if (claimed == 0) {
                        deduped++;
                        continue;
                    }
                    owned.add(new Claim(rowId, member, session));
                }
            }
        }
        // 이월 회수와 묶음 발송은 구 경로 전용이다 — 신 경로에서 부르면 Data 가 발송 이력을
        // 완료 처리하게 되어 두 DB 의 이력이 갈린다(계약 §5).
        if (!notificationDispatcher.isOutboxMode()) {
            targets += collectCarriedClaims(owned, now);
        }
        int sent = notificationDispatcher.isOutboxMode() ? queued : sendBundles(owned, now);
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
     * 이번 스캔이 <b>수신 대상별로</b> 적을 묶음 구성원 — (유저 × 그룹 × 슬롯)마다 그 묶음에 드는
     * 회차 id 전부.
     *
     * <p>구 경로의 보장은 {@link #sendBundles} 의 「한 스캔당 (유저 × 그룹 × 슬롯) 한 건」이었다.
     * 신 경로는 그 한 건을 사건 N 개로 쪼개 outbox 에 적고 relay 가 유저별로 다른 틱에 전달하므로,
     * 구성원을 선언하지 않으면 첫 사건만 도착한 사이에 낀 flush 가 그대로 한 건을 내보내고 나머지가
     * 두 번째 푸시가 된다.
     *
     * <p>같은 묶음이라도 회차마다 마감·참가자가 다르므로 구성원은 «수신자별»로 갈린다 — 이미 참가한
     * 사람의 회차를 남의 묶음에 넣으면 그 유저의 묶음은 영영 도착 완료가 되지 않는다.
     *
     * @param due             슬롯에 도달한 회차
     * @param joined          이미 참가한 (회차, 유저) 키
     * @param membersByGroupId 그룹별 생존 그룹원
     * @return 묶음별 회차 id 집합
     */
    private static Map<BundleKey, List<String>> openBundleMembers(
            List<GroupChallengeBetSession> due, Set<String> joined,
            Map<UUID, List<User>> membersByGroupId) {
        Map<BundleKey, List<String>> members = new LinkedHashMap<>();
        for (GroupChallengeBetSession session : due) {
            Instant slotAt = slotOf(slotStartOf(session));
            for (User member : membersByGroupId.getOrDefault(session.getGroup().getId(), List.of())) {
                if (joined.contains(joinKey(session.getId(), member.getId()))) {
                    continue;
                }
                members.computeIfAbsent(
                        new BundleKey(member.getId(), session.getGroup().getId(), slotAt),
                        key -> new ArrayList<>()).add(session.getId().toString());
            }
        }
        return members;
    }

    /**
     * 조용한 시간에 이월(DEFERRED)해 둔 모집 클레임 중 <b>다음 시도 시각이 도래한</b> 것을 이번
     * 묶음에 합류시킨다(N44). 이월분은 슬롯 유예(2시간)를 이미 넘겼을 수 있어 스캔 경로로는
     * 다시 잡히지 않는다 — 이 경로가 없으면 이월이 곧 영구 미발송이다.
     *
     * <p>합류 전에 <b>지금도 참가할 수 있는지</b>를 본다. 참가 마감이 지났거나 회차가 더는
     * {@code OPEN} 이 아니면 그때서야 "행동할 수 없게 된" 알림이므로 {@code SENT} 로 종결한다
     * (N44 단서). 지우지 않는 이유는 스캔 경로와 같다 — 지우면 다음 틱이 재선점한다.
     *
     * @return 이번에 합류한 클레임 수
     */
    private int collectCarriedClaims(List<Claim> owned, Instant now) {
        List<NotificationSentLog> rows =
                notificationSentLogRepository.findDueDeferredClaimsForUpdate(OWNED_KINDS, now);
        if (rows.isEmpty()) {
            return 0;
        }
        Set<UUID> sessionIds = rows.stream()
                .map(NotificationSentLog::getSubjectId)
                .filter(Objects::nonNull)
                .collect(Collectors.toCollection(LinkedHashSet::new));
        Map<UUID, GroupChallengeBetSession> sessionsById = groupQueryService
                .findAllBetSessions(sessionIds).stream()
                .collect(Collectors.toMap(GroupChallengeBetSession::getId, Function.identity()));
        List<UUID> userIds = rows.stream().map(NotificationSentLog::getUserId).distinct().toList();
        // 탈퇴자는 조회에서 아예 빠지고, 아래 user == null 분기가 그대로 받아 클레임을 닫는다.
        Map<UUID, User> usersById = userQueryService.findAllActive(userIds).stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));

        List<UUID> closed = new ArrayList<>();
        int picked = 0;
        for (NotificationSentLog row : rows) {
            GroupChallengeBetSession session =
                    row.getSubjectId() == null ? null : sessionsById.get(row.getSubjectId());
            User user = usersById.get(row.getUserId());
            if (session == null || user == null
                    || session.getStatus() != GroupBetStatus.OPEN
                    || !now.isBefore(session.getJoinClosesAt())) {
                closed.add(row.getId());
                continue;
            }
            owned.add(new Claim(row.getId(), user, session));
            picked++;
        }
        if (!closed.isEmpty()) {
            notificationSentLogRepository.updateStatusByIds(
                    closed, NotificationSendStatus.SENT, now);
        }
        return picked;
    }

    /** (회차, 유저) 참가 여부 조회 키 — 스캔 필터와 발송 직전 재검증이 같은 축을 쓴다. */
    private static String joinKey(UUID sessionId, UUID userId) {
        return sessionId + ":" + userId;
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
     * 묶음 발송 — (유저 × 그룹 × 슬롯) 한 건.
     *
     * <p><b>발송 직전에 참가 여부를 다시 읽는다.</b> 대상 선정은 스캔 시점 스냅샷이고, 그 뒤로
     * 설정 조회와 유저별 순차 FCM 발송이 도는 동안 참가 API 가 커밋될 수 있다 — 그대로 두면
     * <b>이미 판돈까지 낸 사람에게 "지금 참여할 수 있어요"</b> 가 간다. 유저마다 묻지 않고
     * (회차 집합) 한 번으로 다시 읽는다(N+1 금지). 참가가 확인된 클레임은 <b>반납(삭제)</b>한다 —
     * 다음 틱의 스캔이 참가자를 애초에 대상에서 빼므로 되살아나지 않는다.
     *
     * <p><b>조용한 시간이면 참가 마감과 대조해 가른다</b>(N44):
     * <ul>
     *   <li>조용한 시간 종료 시점에 <b>이미 마감</b> → {@code SENT} 로 종결. 지우면 안 된다 —
     *       15분 크론이 같은 회차를 다음 틱에 다시 선점해 되살아난다.</li>
     *   <li>종료 시점에 <b>아직 참가 가능</b> → {@code DEFERRED} + 다음 시도 시각(그 유저의 조용한
     *       시간 종료). 여기서 종결하면 그 모집은 영구히 나가지 못한다.</li>
     * </ul>
     * 발송 실패·토큰 없음은 반대로 삭제해 남은 슬롯 안에서 재시도를 연다.
     */
    private int sendBundles(List<Claim> owned, Instant now) {
        if (owned.isEmpty()) {
            return 0;
        }
        List<Claim> live = dropClaimsOfJoinedUsers(owned);
        if (live.isEmpty()) {
            return 0;
        }
        Map<BundleKey, List<Claim>> bundles = new LinkedHashMap<>();
        for (Claim claim : live) {
            BundleKey key = new BundleKey(claim.user().getId(), claim.session().getGroup().getId(),
                    slotOf(slotStartOf(claim.session())));
            bundles.computeIfAbsent(key, k -> new ArrayList<>()).add(claim);
        }
        List<UUID> userIds = bundles.keySet().stream().map(BundleKey::userId).distinct().toList();
        Map<UUID, UserNotificationSettings> settingsByUserId =
                userQueryService.findAllNotificationSettings(userIds).stream()
                        .collect(Collectors.toMap(
                                UserNotificationSettings::getUserId, Function.identity()));

        int sent = 0;
        for (Map.Entry<BundleKey, List<Claim>> entry : bundles.entrySet()) {
            List<Claim> claims = entry.getValue();
            List<UUID> rowIds = claims.stream().map(Claim::rowId).toList();
            User user = claims.get(0).user();
            UserNotificationSettings settings = settingsByUserId.get(entry.getKey().userId());
            if (PushNotificationService.isQuietHours(settings, now)) {
                carryOrTerminate(claims, settings, now);
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

    /**
     * 발송 직전 참가 재검증 — 대상 회차를 한 번에 다시 읽어(배치 1회), 스캔 이후 참가가 커밋된
     * 유저의 클레임을 반납한다. 남은 클레임만 돌려준다.
     */
    private List<Claim> dropClaimsOfJoinedUsers(List<Claim> owned) {
        Set<UUID> sessionIds = owned.stream()
                .map(claim -> claim.session().getId())
                .collect(Collectors.toCollection(LinkedHashSet::new));
        Set<String> joined = groupChallengeBetParticipantRepository.findBySessionIdIn(sessionIds)
                .stream()
                .map(p -> joinKey(p.getSession().getId(), p.getUser().getId()))
                .collect(Collectors.toCollection(HashSet::new));
        List<Claim> live = new ArrayList<>();
        List<UUID> joinedRowIds = new ArrayList<>();
        for (Claim claim : owned) {
            if (joined.contains(joinKey(claim.session().getId(), claim.user().getId()))) {
                joinedRowIds.add(claim.rowId());
            } else {
                live.add(claim);
            }
        }
        if (!joinedRowIds.isEmpty()) {
            notificationSentLogRepository.deleteByIds(joinedRowIds);
            log.info("회차 모집 푸시 — 스캔 이후 참가 확인으로 제외 {}건", joinedRowIds.size());
        }
        return live;
    }

    /**
     * 조용한 시간에 걸린 클레임 처리 — 클레임마다 <b>그 회차의 참가 마감</b>과 조용한 시간 종료를
     * 견줘 이월/종결로 가른다(N44 + 그 단서). 한 묶음 안에서도 회차마다 마감이 다르므로 건별이다.
     */
    private void carryOrTerminate(List<Claim> claims, UserNotificationSettings settings, Instant now) {
        Instant quietEnd = PushNotificationService.quietHoursEndAfter(settings, now);
        List<UUID> carried = new ArrayList<>();
        List<UUID> terminated = new ArrayList<>();
        for (Claim claim : claims) {
            if (quietEnd.isBefore(claim.session().getJoinClosesAt())) {
                carried.add(claim.rowId());
            } else {
                terminated.add(claim.rowId());
            }
        }
        if (!carried.isEmpty()) {
            notificationSentLogRepository.deferByIds(carried, quietEnd);
        }
        if (!terminated.isEmpty()) {
            notificationSentLogRepository.updateStatusByIds(
                    terminated, NotificationSendStatus.SENT, now);
        }
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
