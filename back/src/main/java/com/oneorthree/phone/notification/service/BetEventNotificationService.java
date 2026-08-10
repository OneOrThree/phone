package com.oneorthree.phone.notification.service;

import com.fasterxml.uuid.Generators;
import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupBetVoidReason;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
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
 * 내기 <b>사건 단위</b> 알림 파이프라인 (GROMO-1417 · 1282, N41·N44·N48·N20) —
 * 정산 결과({@code BET_RESULT})와 무효화 환불({@code BET_VOID_REFUND})의 유일한 발송 경로다.
 *
 * <p><b>진입은 둘, 규칙은 하나.</b> ① 회차 종료 커밋 직후의 이벤트
 * ({@code GroupBetSessionClosedEvent} → AFTER_COMMIT 리스너)가 즉시성을 만들고 — 종전 일 2회
 * (08:00·13:00) 배치는 당일 정산 결과가 최대 하루 늦었다 — ② 15분 재훑기 크론이 이벤트 유실·발송
 * 실패·죽은 워커의 리스 만료 건을 회수한다. 어느 경로로 와도 dedup 은 같은 축이다.
 *
 * <p><b>선점 dedup(N41)</b> — 발송 전에 사건 유니크 {@code (user_id, kind, subject_id=회차 id)}
 * 로 {@code PENDING} 행을 INSERT 해 선점한다(충돌 = 남이 선점 → 스킵). 같은 kind 라도 회차가
 * 다르면 별도 클레임이라 연속 정산이 유실되지 않는다. 선점 후 10분({@link #CLAIM_LEASE})이 지난
 * {@code PENDING} 은 죽은 워커로 간주해 재클레임한다.
 *
 * <p><b>묶음(N20·GROMO-1282)</b> — 클레임은 사건마다, 푸시는 슬롯마다다. 같은
 * (유저 × 그룹 × 15분 슬롯 × kind) 의 미발송 사건은 한 건으로 묶고, 묶음 payload 에는 특정
 * {@code challengeId} 를 싣지 않는다(IA §4.2 — 어느 것을 고를 근거가 없다). 슬롯은 발송 시각이
 * 아니라 <b>사건 시각({@code settled_at})</b> 기준이다 — 재훑기·이월이 언제 돌아도 묶음이 같다.
 *
 * <p><b>조용한 시간 이월(N44)</b> — 유저의 quiet hours(기본 23–07)에 걸린 표시 푸시는 버리지 않고
 * {@code DEFERRED} 로 두었다가 조용한 시간이 끝난 첫 틱(07:00 정각 포함)에 발송한다. 하루형은
 * 자정 정산이라 이월이 없으면 결과 알림이 매번 침묵한다. dedup·묶음은 원래 슬롯 기준을 유지한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class BetEventNotificationService {

    /** 결과 알림에 붙일 링크 — 구앱 브리지(data.link 라우팅). 신앱은 data.groupId 로 합성한다. */
    static final String GROUP_DEEP_LINK_PREFIX = "gromo://group?g=";

    /** PENDING 클레임 리스 — 이 시간이 지나면 죽은 워커의 선점으로 보고 재클레임한다. */
    public static final Duration CLAIM_LEASE = Duration.ofMinutes(10);

    /**
     * 재훑기 구간 — 최근 48시간의 종료 회차를 통째로 다시 훑는다. "직전 발송 이후"를 상태로 들지
     * 않기 위한 폭이며, 이 구간을 벗어난 미발송 건은 포기한다(뒤늦은 결과 푸시가 오히려 혼란).
     */
    static final Duration SETTLEMENT_LOOKBACK = Duration.ofHours(48);

    /** 묶음 시간슬롯 폭 — 같은 무렵의 사건을 한 푸시로 접는 단위(N20). */
    private static final Duration SLOT_WIDTH = Duration.ofMinutes(15);

    /**
     * 알림 대상 종료 상태 — SETTLED·FORFEITED 는 결과(BET_RESULT), VOIDED·REFUNDED 는 환불 통지
     * (BET_VOID_REFUND, N48). UNUSED(0명 종료)는 알릴 대상 자체가 없다(N52).
     */
    private static final List<GroupBetStatus> NOTIFIABLE_STATUSES = List.of(
            GroupBetStatus.SETTLED, GroupBetStatus.FORFEITED,
            GroupBetStatus.VOIDED, GroupBetStatus.REFUNDED);

    private final GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    private final GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    private final UserNotificationSettingsRepository userNotificationSettingsRepository;
    private final NotificationSentLogRepository notificationSentLogRepository;
    private final PushNotificationService pushNotificationService;

    /** 소유한 클레임 1건 — 행 id 와, 문구 조립에 필요한 회차·참가 스냅샷. */
    private record Claim(UUID rowId, String kind, GroupChallengeBetSession session,
            GroupChallengeBetParticipant participant) {
    }

    /** 묶음 키 — (유저 × 그룹 × 슬롯 × kind). dedup 키(사건 단위)와는 분리다(N41). */
    private record BundleKey(UUID userId, UUID groupId, Instant slotAt, String kind) {
    }

    private record SendCounts(int sent, int skipped) {
    }

    /** 이월 flush 집계 — targets = 처리한 DEFERRED 행 수, sent 를 뺀 나머지는 스킵(잔류·소비 포함). */
    private record FlushCounts(int targets, int sent, int skipped) {
    }

    /**
     * 이벤트 경로 진입점 — 회차 종료 커밋 직후({@code AFTER_COMMIT} 리스너 경유) 그 회차의
     * 참가자 알림을 즉시 클레임·발송한다. 실패해도 15분 재훑기가 회수하므로 예외는 호출측
     * (리스너)이 삼킨다.
     */
    @Transactional
    public void notifySessionClosed(UUID sessionId, Instant now) {
        GroupChallengeBetSession session =
                groupChallengeBetSessionRepository.findById(sessionId).orElse(null);
        if (session == null) {
            return;
        }
        dispatch(List.of(session), now, System.currentTimeMillis());
    }

    /** 크론(15분)·수동 트리거 진입점. */
    @Transactional
    public PushDispatchSummaryResponse rescanAndFlush() {
        return rescanAndFlush(Instant.now());
    }

    /**
     * 재훑기 + 이월 flush — ① DEFERRED(조용한 시간 이월) 건 중 지금 보낼 수 있는 것을 발송하고,
     * ② 최근 48시간 종료 회차를 다시 훑어 미클레임·리스 만료 건을 회수한다. dedup 이 선점 기반이라
     * 이벤트 경로와 겹쳐 돌아도 이중 발송이 없다.
     */
    @Transactional
    public PushDispatchSummaryResponse rescanAndFlush(Instant now) {
        long startedAtMillis = System.currentTimeMillis();
        FlushCounts flushed = flushDeferred(now);
        List<GroupChallengeBetSession> sessions = groupChallengeBetSessionRepository
                .findByStatusInAndSettledAtSince(NOTIFIABLE_STATUSES, now.minus(SETTLEMENT_LOOKBACK));
        PushDispatchSummaryResponse scanned = dispatch(sessions, now, startedAtMillis);
        PushDispatchSummaryResponse summary = new PushDispatchSummaryResponse(
                scanned.targetCount() + flushed.targets(),
                scanned.sentCount() + flushed.sent(),
                scanned.dedupedCount(),
                scanned.skippedCount() + flushed.skipped(),
                System.currentTimeMillis() - startedAtMillis);
        log.info("내기 사건 알림 재훑기 — 종료 회차 {}건, 이월 {}건, 대상 {}건, 발송 {}건, dedup {}건, "
                + "스킵 {}건, elapsedMillis={}", sessions.size(), flushed.targets(),
                summary.targetCount(), summary.sentCount(), summary.dedupedCount(),
                summary.skippedCount(), summary.elapsedMillis());
        return summary;
    }

    /** 회차 종료 상태 → 알림 kind. 알림 없는 상태(OPEN·UNUSED)는 null. */
    static String kindOf(GroupBetStatus status) {
        return switch (status) {
            case SETTLED, FORFEITED -> NotificationSentLog.TYPE_BET_RESULT;
            case VOIDED, REFUNDED -> NotificationSentLog.TYPE_BET_VOID_REFUND;
            default -> null;
        };
    }

    /** 사건 시각 → 묶음 슬롯(15분 경계 내림) — 발송 시각과 무관하게 결정적이다(N44 원래 슬롯 기준). */
    static Instant slotOf(Instant eventAt) {
        long slotMillis = SLOT_WIDTH.toMillis();
        return Instant.ofEpochMilli(Math.floorDiv(eventAt.toEpochMilli(), slotMillis) * slotMillis);
    }

    /** 종료 회차 목록에 대해 클레임 → 묶음 → 발송을 수행한다. */
    private PushDispatchSummaryResponse dispatch(
            List<GroupChallengeBetSession> sessions, Instant now, long startedAtMillis) {
        Map<UUID, GroupChallengeBetSession> sessionsById = sessions.stream()
                .filter(s -> kindOf(s.getStatus()) != null && s.getSettledAt() != null)
                .collect(Collectors.toMap(GroupChallengeBetSession::getId, Function.identity()));
        if (sessionsById.isEmpty()) {
            return summary(0, 0, 0, 0, startedAtMillis);
        }
        // 탈퇴 유저는 발송 대상이 아니다(참가 행은 정산 이력으로 남는다).
        List<GroupChallengeBetParticipant> targets = groupChallengeBetParticipantRepository
                .findBySessionIdIn(sessionsById.keySet()).stream()
                .filter(p -> sessionsById.containsKey(p.getSession().getId()))
                .filter(p -> !p.getUser().isDeleted())
                .toList();
        if (targets.isEmpty()) {
            return summary(0, 0, 0, 0, startedAtMillis);
        }

        int deduped = 0;
        List<Claim> owned = new ArrayList<>();
        for (GroupChallengeBetParticipant participant : targets) {
            GroupChallengeBetSession session = sessionsById.get(participant.getSession().getId());
            String kind = kindOf(session.getStatus());
            UUID rowId = claimEvent(participant.getUser().getId(), kind, session, now);
            if (rowId == null) {
                deduped++;
                continue;
            }
            owned.add(new Claim(rowId, kind, session, participant));
        }
        SendCounts counts = sendBundles(owned, now);
        return summary(targets.size(), counts.sent(), deduped, counts.skipped(), startedAtMillis);
    }

    /**
     * 사건 1건 선점 — INSERT(PENDING) 시도, 충돌이면 리스 만료 재클레임 시도. 소유하지 못하면
     * null(이미 발송됐거나 남의 리스가 살아 있다).
     */
    private UUID claimEvent(UUID userId, String kind, GroupChallengeBetSession session, Instant now) {
        UUID rowId = Generators.timeBasedEpochRandomGenerator().generate();
        int inserted = notificationSentLogRepository.insertPendingClaim(rowId, userId, kind,
                session.getId(), session.getGroup().getId(), slotOf(session.getSettledAt()), now);
        if (inserted == 1) {
            return rowId;
        }
        int reclaimed = notificationSentLogRepository.reclaimExpired(
                userId, kind, session.getId(), now.minus(CLAIM_LEASE), now);
        if (reclaimed == 0) {
            return null;
        }
        return notificationSentLogRepository.findByUserIdAndKindAndSubjectId(userId, kind, session.getId())
                .map(NotificationSentLog::getId)
                .orElse(null);
    }

    /**
     * 이월 대기(DEFERRED) flush(N44) — 조용한 시간이 끝난 유저의 건을 원래 슬롯 기준으로 묶어
     * 발송한다. 아직 조용한 시간인 유저의 건은 그대로 남아 다음 틱을 기다린다. 회차·참가 행이
     * 사라져 재조립할 수 없는 건은 SENT 로 소비 확정한다(영구 잔류 방지).
     */
    FlushCounts flushDeferred(Instant now) {
        List<NotificationSentLog> rows =
                notificationSentLogRepository.findByStatus(NotificationSendStatus.DEFERRED);
        if (rows.isEmpty()) {
            return new FlushCounts(0, 0, 0);
        }
        Set<UUID> sessionIds = rows.stream()
                .map(NotificationSentLog::getSubjectId)
                .filter(Objects::nonNull)
                .collect(Collectors.toCollection(LinkedHashSet::new));
        Map<UUID, GroupChallengeBetSession> sessionsById = groupChallengeBetSessionRepository
                .findAllById(sessionIds).stream()
                .collect(Collectors.toMap(GroupChallengeBetSession::getId, Function.identity()));
        Map<String, GroupChallengeBetParticipant> participantsByKey = sessionIds.isEmpty()
                ? Map.of()
                : groupChallengeBetParticipantRepository.findBySessionIdIn(sessionIds).stream()
                        .collect(Collectors.toMap(
                                p -> p.getSession().getId() + ":" + p.getUser().getId(),
                                Function.identity()));

        List<Claim> claims = new ArrayList<>();
        List<UUID> unrecoverable = new ArrayList<>();
        for (NotificationSentLog row : rows) {
            GroupChallengeBetSession session =
                    row.getSubjectId() == null ? null : sessionsById.get(row.getSubjectId());
            GroupChallengeBetParticipant participant = session == null
                    ? null
                    : participantsByKey.get(session.getId() + ":" + row.getUserId());
            if (session == null || participant == null || participant.getUser().isDeleted()) {
                unrecoverable.add(row.getId());
                continue;
            }
            claims.add(new Claim(row.getId(), row.getKind(), session, participant));
        }
        if (!unrecoverable.isEmpty()) {
            notificationSentLogRepository.updateStatusByIds(
                    unrecoverable, NotificationSendStatus.SENT, now);
        }
        SendCounts counts = sendBundles(claims, now);
        log.info("내기 알림 이월 flush — 대기 {}건, 발송 {}건", rows.size(), counts.sent());
        return new FlushCounts(rows.size(), counts.sent(), rows.size() - counts.sent());
    }

    /**
     * 묶음 발송 본체 — (유저 × 그룹 × 슬롯 × kind) 로 접어 묶음당 1건을 보낸다. 조용한 시간이면
     * DEFERRED 마킹(N44), 성사면 SENT, 실패·필터 스킵이면 클레임을 지워 재훑기가 다시 집게 한다.
     */
    private SendCounts sendBundles(List<Claim> owned, Instant now) {
        if (owned.isEmpty()) {
            return new SendCounts(0, 0);
        }
        Map<BundleKey, List<Claim>> bundles = new LinkedHashMap<>();
        for (Claim claim : owned) {
            BundleKey key = new BundleKey(claim.participant().getUser().getId(),
                    claim.session().getGroup().getId(),
                    slotOf(claim.session().getSettledAt()), claim.kind());
            bundles.computeIfAbsent(key, k -> new ArrayList<>()).add(claim);
        }
        List<UUID> userIds = bundles.keySet().stream().map(BundleKey::userId).distinct().toList();
        Map<UUID, UserNotificationSettings> settingsByUserId =
                userNotificationSettingsRepository.findAllById(userIds).stream()
                        .collect(Collectors.toMap(
                                UserNotificationSettings::getUserId, Function.identity()));

        int sent = 0;
        int skipped = 0;
        for (Map.Entry<BundleKey, List<Claim>> entry : bundles.entrySet()) {
            List<Claim> claims = entry.getValue();
            List<UUID> rowIds = claims.stream().map(Claim::rowId).toList();
            User user = claims.get(0).participant().getUser();
            UserNotificationSettings settings = settingsByUserId.get(user.getId());
            if (PushNotificationService.isQuietHours(settings, now)) {
                // 표시 푸시는 버리지 않고 이월한다(N44) — 원래 슬롯(slot_at)은 행에 이미 있다.
                notificationSentLogRepository.updateStatusByIds(
                        rowIds, NotificationSendStatus.DEFERRED, null);
                skipped += claims.size();
                continue;
            }
            boolean soundEnabled = settings == null || settings.isSoundEnabled();
            PushMessage message = composeBundle(entry.getKey().kind(), claims, soundEnabled);
            try {
                if (pushNotificationService.sendIfAllowed(user, settings, message, now)) {
                    notificationSentLogRepository.updateStatusByIds(
                            rowIds, NotificationSendStatus.SENT, now);
                    sent += claims.size();
                } else {
                    // 필터 스킵·FCM 실패 — 선점을 반납해 재훑기(48h)가 다시 집게 한다.
                    notificationSentLogRepository.deleteByIds(rowIds);
                    skipped += claims.size();
                }
            } catch (RuntimeException e) {
                notificationSentLogRepository.deleteByIds(rowIds);
                skipped += claims.size();
                log.warn("내기 사건 알림 발송 실패 — userId={}, kind={}, 사건 {}건",
                        user.getId(), entry.getKey().kind(), claims.size(), e);
            }
        }
        return new SendCounts(sent, skipped);
    }

    /** 묶음 문구·payload 조립 — 단건은 상세, 다건은 요약(특정 challengeId 를 싣지 않는다 — IA §4.2). */
    PushMessage composeBundle(String kind, List<Claim> claims, boolean soundEnabled) {
        if (claims.size() == 1) {
            return composeSingle(kind, claims.get(0), soundEnabled);
        }
        GroupChallengeBetSession first = claims.get(0).session();
        UUID groupId = first.getGroup().getId();
        Map<String, String> data = new LinkedHashMap<>();
        data.put("type", kind);
        data.put("groupId", groupId.toString());
        if (NotificationSentLog.TYPE_BET_VOID_REFUND.equals(kind)) {
            // 사유는 전부 같을 때만 싣는다 — 섞이면 대표를 고를 근거가 없다(묶음 challengeId 와 같은 원리).
            Set<GroupBetVoidReason> reasons = claims.stream()
                    .map(c -> c.session().getVoidReason())
                    .collect(Collectors.toCollection(HashSet::new));
            if (reasons.size() == 1 && !reasons.contains(null)) {
                data.put("voidReason", reasons.iterator().next().name());
            }
            return new PushMessage("참가비를 돌려드렸어요",
                    "내기 " + claims.size() + "건이 무산돼 참가비를 돌려드렸어요",
                    null, soundEnabled, data);
        }
        return new PushMessage("내기 결과가 나왔어요",
                "내기 결과 " + claims.size() + "건이 나왔어요 — 그룹에서 확인하세요",
                GROUP_DEEP_LINK_PREFIX + groupId, soundEnabled, data);
    }

    /**
     * 단건 문구·payload — 결과 3종(승/패/몰수, B4 문구 보존)과 환불 사유 3종(N48). payload 는
     * IA §4.2: {@code groupId} 필수 + 단건은 {@code challengeId}, 환불은 {@code voidReason}.
     * 결과 알림의 {@code link} 는 구앱 브리지(계약 §2)로 유지하고, 신설 타입(BET_VOID_REFUND)은
     * 싣지 않는다 — 앱이 {@code data.groupId} 로 딥링크를 합성한다(IA §4.2).
     */
    PushMessage composeSingle(String kind, Claim claim, boolean soundEnabled) {
        GroupChallengeBetSession session = claim.session();
        UUID groupId = session.getGroup().getId();
        Map<String, String> data = new LinkedHashMap<>();
        data.put("type", kind);
        data.put("groupId", groupId.toString());
        data.put("challengeId", session.getChallenge().getId().toString());
        if (NotificationSentLog.TYPE_BET_VOID_REFUND.equals(kind)) {
            GroupBetVoidReason reason = session.getVoidReason();
            if (reason != null) {
                data.put("voidReason", reason.name());
            }
            String body;
            if (reason == GroupBetVoidReason.CHALLENGE_DELETED) {
                body = "챌린지가 삭제돼 무산됐어요 · 참가비는 돌려드렸어요";
            } else if (reason == GroupBetVoidReason.INSUFFICIENT_PARTICIPANTS) {
                body = "참가자가 부족해 무산됐어요 · 참가비는 돌려드렸어요";
            } else if (reason == GroupBetVoidReason.REFUND_DEADLINE) {
                body = "정산이 지연돼 참가비를 돌려드렸어요";
            } else {
                body = "내기가 무산돼 참가비를 돌려드렸어요";
            }
            return new PushMessage("참가비를 돌려드렸어요", body, null, soundEnabled, data);
        }
        String body;
        if (session.getStatus() == GroupBetStatus.FORFEITED) {
            body = "아무도 목표를 달성하지 못해 참가비가 소멸됐어요";
        } else if (Boolean.TRUE.equals(claim.participant().getAchieved())) {
            int payout = claim.participant().getPayout() == null ? 0 : claim.participant().getPayout();
            body = "내기에서 이겼어요! +" + payout + "코인 🎉";
        } else {
            body = "아쉬워요 — 목표 미달성으로 참가비 " + session.getStake() + "코인을 잃었어요";
        }
        return new PushMessage("내기 결과가 나왔어요", body,
                GROUP_DEEP_LINK_PREFIX + groupId, soundEnabled, data);
    }

    private PushDispatchSummaryResponse summary(
            int targetCount, int sent, int deduped, int skipped, long startedAtMillis) {
        return new PushDispatchSummaryResponse(
                targetCount, sent, deduped, skipped, System.currentTimeMillis() - startedAtMillis);
    }
}
