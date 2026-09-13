package com.oneorthree.phone.internal.notification.service;

import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.friend.repository.domain.FriendshipStatus;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.GroupChallengeStatus;
import com.oneorthree.phone.internal.notification.dto.NotificationEligibilityRequest;
import com.oneorthree.phone.internal.notification.dto.NotificationEligibilityResponse;
import com.oneorthree.phone.notification.producer.NotificationKind;
import com.oneorthree.phone.notification.producer.NotificationExpiry;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.time.DateTimeException;
import java.util.UUID;

/**
 * 발송 직전 <b>상태 재확인</b> — 투영이 대체하지 못하는 질문에 코어가 답한다 (A22 ⓩ · ㊩ · ⓜ).
 *
 * <h2>왜 필요한가</h2>
 * 구 경로는 발송 직전에 코어를 다시 읽어 거짓 알림을 막았다: 삭제·종료된 챌린지의 개설 알림
 * ({@code ChallengeCreatedNotificationService}), 이미 처리된 친구 요청
 * ({@code FriendNotificationService#isStillPending}), 스캔 이후 참가한 유저의 모집 알림
 * ({@code SessionOpenNotificationService#dropClaimsOfJoinedUsers}). 그 재조회가 사라지면
 * <b>탭해도 아무것도 없는 알림</b>이 그대로 나간다.
 *
 * <h2>모르는 kind 는 거절한다</h2>
 * 「모르면 일단 허용」은 새 kind 가 붙을 때마다 재확인을 <b>조용히</b> 건너뛴다 — 그리고 그 사실이
 * 어디에도 드러나지 않는다. 반대로 거절은 발송이 멈춰 즉시 눈에 띈다.
 *
 * <h2>일시 오류를 {@code false} 로 삼키지 않는다</h2>
 * 이 서비스는 조회 실패를 잡지 않는다. DB 장애가 «정책상 안 보냄»으로 둔갑하면 장애 동안의 알림이
 * 통째로 사라지고, 나중에 되짚을 근거도 남지 않는다. 예외는 그대로 올라가 5xx 가 되고, 알림 서버는
 * 그것을 «판정 못 함 = 재시도»로 다룬다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class NotificationEligibilityService {

    /** 거절 사유 — 알 수 없는 종류. */
    static final String REASON_UNKNOWN_KIND = "UNKNOWN_KIND";
    /** 거절 사유 — 수신자가 없거나 탈퇴했다. */
    static final String REASON_USER_INACTIVE = "USER_INACTIVE";
    /** 거절 사유 — 대상 id 가 필요한 kind 인데 비어 있다. */
    static final String REASON_SUBJECT_REQUIRED = "SUBJECT_REQUIRED";
    /** 거절 사유 — 대상이 사라졌다. */
    static final String REASON_SUBJECT_GONE = "SUBJECT_GONE";
    /** 거절 사유 — 챌린지가 삭제·종료됐다. */
    static final String REASON_CHALLENGE_INACTIVE = "CHALLENGE_INACTIVE";
    /** 거절 사유 — 그룹원이 아니다(탈퇴·강퇴). */
    static final String REASON_NOT_GROUP_MEMBER = "NOT_GROUP_MEMBER";
    /** 거절 사유 — 친구 요청이 이미 수락·거절됐다. */
    static final String REASON_REQUEST_RESOLVED = "REQUEST_RESOLVED";
    /** 거절 사유 — 회차가 더는 모집 중이 아니다. */
    static final String REASON_SESSION_CLOSED = "SESSION_CLOSED";
    /** 거절 사유 — 참가 마감이 지났다. */
    static final String REASON_JOIN_CLOSED = "JOIN_CLOSED";
    /** 거절 사유 — 이미 참가했다. */
    static final String REASON_ALREADY_JOINED = "ALREADY_JOINED";
    /** 거절 사유 — 그 회차의 참가자가 아니다. */
    static final String REASON_NOT_PARTICIPANT = "NOT_PARTICIPANT";
    /** 거절 사유 — 회차가 아직 종료되지 않았다(결과 알림 대상이 아니다). */
    static final String REASON_NOT_SETTLED = "NOT_SETTLED";
    /** 거절 사유 — 승리 알림을 보낼 수 없는 무산·환불 등의 회차다. */
    static final String REASON_SESSION_INVALIDATED = "SESSION_INVALIDATED";
    /** 거절 사유 — 해당 참가자의 승리가 확정되지 않았다. */
    static final String REASON_WIN_NOT_CONFIRMED = "WIN_NOT_CONFIRMED";

    /** 친구 요청 판정에 쓰는 {@code params} 키 — 요청 행 id. */
    static final String PARAM_REQUEST_ID = "requestId";

    private final UserQueryService userQueryService;
    private final GroupQueryService groupQueryService;
    private final GroupMemberRepository groupMemberRepository;
    private final GroupChallengeBetParticipantRepository betParticipantRepository;
    private final FriendshipRepository friendshipRepository;
    private final Clock clock;
    private final NotificationRetentionEligibility retentionEligibility;

    /**
     * 지금 이 알림을 보내도 되는가.
     *
     * @param request 수신자·종류·대상·추가 입력
     * @return 허용 또는 사유가 실린 거절
     */
    @Transactional(readOnly = true)
    public NotificationEligibilityResponse evaluate(NotificationEligibilityRequest request) {
        NotificationKind kind = NotificationKind.find(request.kind());
        if (kind == null) {
            log.warn("알 수 없는 알림 종류로 적격성 조회 — kind={}", request.kind());
            return NotificationEligibilityResponse.deny(REASON_UNKNOWN_KIND);
        }
        // 모든 종류의 공통 전제 — 탈퇴자에게는 무엇도 보내지 않는다.
        User user = userQueryService.findActive(request.userId()).orElse(null);
        if (user == null) {
            return NotificationEligibilityResponse.deny(REASON_USER_INACTIVE);
        }
        if (kind.subjectKind() != NotificationKind.SubjectKind.NONE && request.subjectId() == null) {
            return NotificationEligibilityResponse.deny(REASON_SUBJECT_REQUIRED);
        }
        NotificationEligibilityResponse expiry = checkExpiry(request, kind);
        if (expiry != null) {
            return expiry;
        }
        return switch (kind) {
            case CHALLENGE_CREATED -> evaluateChallengeCreated(request);
            case CHALLENGE_SESSION_OPEN -> evaluateSessionOpen(request);
            case BET_RESULT, BET_VOID_REFUND -> evaluateBetResult(request);
            case BET_WON -> evaluateBetWon(request);
            case BET_SILENT_FLUSH -> evaluateBetParticipation(request);
            case CHALLENGE_WINDOW_END, CHALLENGE_ENDED -> evaluateChallengeEnd(request);
            case FRIEND_REQUEST -> evaluateFriendRequest(request);
            case FRIEND_ACCEPTED -> evaluateFriendAccepted(request);
            case INACTIVE_RETURN, MISSED_FOCUS_TODAY, STREAK_AT_RISK ->
                    retentionEligibility.evaluate(request, user, clock.instant());
            // 추가 도메인 조회가 없는 종류. 시간 제한이 있는 리그·리텐션은 위에서 만료를 확인했다.
            case LEAGUE_WEEKLY_RESULT, LEAGUE_DEADLINE, LEAGUE_DEADLINE_D1,
                 LEAGUE_RELEGATION_WARNING, LEAGUE_RELEGATION_WARNING_EVENING, LEAGUE_FINAL_DEADLINE ->
                    NotificationEligibilityResponse.allow();
        };
    }

    /** null은 시간 판정 통과다. 원시각 없는 과거 봉투를 수신 시각으로 새롭게 만들지 않는다. */
    private NotificationEligibilityResponse checkExpiry(NotificationEligibilityRequest request, NotificationKind kind) {
        Instant testAt = request.adminTestRequestedAt();
        if (testAt != null) {
            // 오직 알림 서버의 admin_actor + replay_of 정본 판정에서 오는 맥락이다.
            // 시험도 새로고침·재시도로 수명이 늘지 않으며, 실제 수신자/대상 검사는 건너뛰지 않는다.
            Instant now = clock.instant();
            if (now.isBefore(testAt)) {
                return NotificationEligibilityResponse.deny("EVENT_TIME_INVALID");
            }
            return now.isBefore(testAt.plusSeconds(900)) ? null
                    : NotificationEligibilityResponse.deny("EVENT_EXPIRED");
        }
        if (NotificationExpiry.validity(kind) == null) {
            return null;
        }
        Object original = request.params().get(NotificationExpiry.OCCURRED_AT);
        if (!(original instanceof String occurredAt)) {
            return NotificationEligibilityResponse.deny("EVENT_TIME_REQUIRED");
        }
        try {
            Instant expiry = NotificationExpiry.expiresAt(kind, Instant.parse(occurredAt));
            Object declared = request.params().get(NotificationExpiry.EXPIRES_AT);
            if (declared != null && (!(declared instanceof String value)
                    || !expiry.equals(Instant.parse(value)))) {
                return NotificationEligibilityResponse.deny("EVENT_TIME_INVALID");
            }
            return clock.instant().isBefore(expiry) ? null : NotificationEligibilityResponse.deny("EVENT_EXPIRED");
        } catch (DateTimeException | ArithmeticException invalid) {
            return NotificationEligibilityResponse.deny("EVENT_TIME_INVALID");
        }
    }

    /** 개설 알림 — 챌린지가 아직 살아 있고 수신자가 아직 그 그룹원이어야 한다(ⓩ). */
    private NotificationEligibilityResponse evaluateChallengeCreated(NotificationEligibilityRequest request) {
        GroupChallenge challenge = groupQueryService.findChallenge(request.subjectId()).orElse(null);
        if (challenge == null) {
            return NotificationEligibilityResponse.deny(REASON_SUBJECT_GONE);
        }
        if (challenge.getDeletedAt() != null || challenge.getStatus() != GroupChallengeStatus.ACTIVE) {
            return NotificationEligibilityResponse.deny(REASON_CHALLENGE_INACTIVE);
        }
        if (!groupMemberRepository.existsByGroupIdAndUserId(
                challenge.getGroup().getId(), request.userId())) {
            return NotificationEligibilityResponse.deny(REASON_NOT_GROUP_MEMBER);
        }
        return NotificationEligibilityResponse.allow();
    }

    /**
     * 종료 알림 — 챌린지 행이 남아 있고 수신자가 아직 그룹원이어야 한다.
     *
     * <p>{@code ACTIVE} 를 요구하지 않는다. 이 알림은 <b>끝났다</b>는 통지라 {@code ENDED} 가 정상
     * 상태다. 삭제는 다르다 — 삭제된 챌린지의 결과 화면은 열리지 않는다.
     */
    private NotificationEligibilityResponse evaluateChallengeEnd(NotificationEligibilityRequest request) {
        GroupChallenge challenge = groupQueryService.findChallenge(request.subjectId()).orElse(null);
        if (challenge == null) {
            return NotificationEligibilityResponse.deny(REASON_SUBJECT_GONE);
        }
        if (challenge.getDeletedAt() != null) {
            return NotificationEligibilityResponse.deny(REASON_CHALLENGE_INACTIVE);
        }
        if (!groupMemberRepository.existsByGroupIdAndUserId(
                challenge.getGroup().getId(), request.userId())) {
            return NotificationEligibilityResponse.deny(REASON_NOT_GROUP_MEMBER);
        }
        return NotificationEligibilityResponse.allow();
    }

    /**
     * 모집 알림 — 현재 그룹원이며 회차가 아직 {@code OPEN} 이고 참가 마감 전이며
     * <b>아직 참가하지 않았어야</b> 한다.
     *
     * <p>마지막 조건이 핵심이다. 구 경로는 발송 직전에 참가 여부를 다시 읽었다 — 그러지 않으면
     * 이미 판돈까지 낸 사람에게 「지금 참여할 수 있어요」가 간다.
     */
    private NotificationEligibilityResponse evaluateSessionOpen(NotificationEligibilityRequest request) {
        GroupChallengeBetSession session =
                groupQueryService.findBetSession(request.subjectId()).orElse(null);
        if (session == null) {
            return NotificationEligibilityResponse.deny(REASON_SUBJECT_GONE);
        }
        if (session.getStatus() != GroupBetStatus.OPEN) {
            return NotificationEligibilityResponse.deny(REASON_SESSION_CLOSED);
        }
        if (!clock.instant().isBefore(session.getJoinClosesAt())) {
            return NotificationEligibilityResponse.deny(REASON_JOIN_CLOSED);
        }
        if (!groupMemberRepository.existsByGroupIdAndUserId(session.getGroup().getId(), request.userId())) {
            return NotificationEligibilityResponse.deny(REASON_NOT_GROUP_MEMBER);
        }
        if (betParticipantRepository.findBySessionIdAndUserId(session.getId(), request.userId())
                .isPresent()) {
            return NotificationEligibilityResponse.deny(REASON_ALREADY_JOINED);
        }
        return NotificationEligibilityResponse.allow();
    }

    /** 결과·환불 알림 — 회차가 실제로 종료됐고 수신자가 그 회차 참가자여야 한다. */
    private NotificationEligibilityResponse evaluateBetResult(NotificationEligibilityRequest request) {
        GroupChallengeBetSession session =
                groupQueryService.findBetSession(request.subjectId()).orElse(null);
        if (session == null) {
            return NotificationEligibilityResponse.deny(REASON_SUBJECT_GONE);
        }
        if (session.getStatus() == GroupBetStatus.OPEN) {
            return NotificationEligibilityResponse.deny(REASON_NOT_SETTLED);
        }
        return participantOrDeny(session.getId(), request.userId());
    }

    /**
     * 승리 확정 — OPEN의 조기 확정과 SETTLED의 승자는 허용하지만 무산·환불 회차는 제외한다.
     * 환불은 achieved=true를 지우지 않으므로 회차 상태도 함께 대조해야 한다.
     */
    private NotificationEligibilityResponse evaluateBetWon(NotificationEligibilityRequest request) {
        GroupChallengeBetSession session = groupQueryService.findBetSession(request.subjectId()).orElse(null);
        if (session == null) {
            return NotificationEligibilityResponse.deny(REASON_SUBJECT_GONE);
        }
        if (session.getStatus() != GroupBetStatus.OPEN && session.getStatus() != GroupBetStatus.SETTLED) {
            return NotificationEligibilityResponse.deny(REASON_SESSION_INVALIDATED);
        }
        GroupChallengeBetParticipant participant = betParticipantRepository
                .findBySessionIdAndUserId(session.getId(), request.userId()).orElse(null);
        if (participant == null) {
            return NotificationEligibilityResponse.deny(REASON_NOT_PARTICIPANT);
        }
        return Boolean.TRUE.equals(participant.getAchieved())
                ? NotificationEligibilityResponse.allow()
                : NotificationEligibilityResponse.deny(REASON_WIN_NOT_CONFIRMED);
    }

    /** 사일런트 flush — 수신자가 그 회차 참가자이기만 하면 된다. */
    private NotificationEligibilityResponse evaluateBetParticipation(NotificationEligibilityRequest request) {
        if (groupQueryService.findBetSession(request.subjectId()).isEmpty()) {
            return NotificationEligibilityResponse.deny(REASON_SUBJECT_GONE);
        }
        return participantOrDeny(request.subjectId(), request.userId());
    }

    private NotificationEligibilityResponse participantOrDeny(UUID sessionId, UUID userId) {
        return betParticipantRepository.findBySessionIdAndUserId(sessionId, userId).isPresent()
                ? NotificationEligibilityResponse.allow()
                : NotificationEligibilityResponse.deny(REASON_NOT_PARTICIPANT);
    }

    /** 수락 사실은 친구 해제 뒤에도 유효하지만, 탈퇴한 상대의 보존된 닉네임은 전송하지 않는다. */
    private NotificationEligibilityResponse evaluateFriendAccepted(NotificationEligibilityRequest request) {
        return userQueryService.findActive(request.subjectId()).isPresent()
                ? NotificationEligibilityResponse.allow()
                : NotificationEligibilityResponse.deny(REASON_SUBJECT_GONE);
    }

    /**
     * 친구 요청 알림 — 그 요청이 <b>아직 대기 중</b>이어야 한다(ⓜ · ㊩).
     *
     * <p>판정 축은 {@code subjectId}(상대 유저)가 아니라 {@code params.requestId}(요청 행)다. 거절 후
     * 재요청이 같은 행을 되살리므로 상대 유저만으로는 「같은 요청」을 식별할 수 없다.
     * {@code requestId} 가 없으면 <b>판정할 수 없으므로 거절한다</b> — 통과시키면 이미 수락된 요청의
     * 알림이 그대로 나간다.
     */
    private NotificationEligibilityResponse evaluateFriendRequest(NotificationEligibilityRequest request) {
        Object raw = request.params().get(PARAM_REQUEST_ID);
        if (raw == null) {
            return NotificationEligibilityResponse.deny(REASON_SUBJECT_REQUIRED);
        }
        UUID requestId;
        try {
            requestId = raw instanceof UUID uuid ? uuid : UUID.fromString(String.valueOf(raw));
        } catch (IllegalArgumentException e) {
            return NotificationEligibilityResponse.deny(REASON_SUBJECT_REQUIRED);
        }
        return friendshipRepository.findStatusByIdAndDeletedAtIsNull(requestId)
                .filter(FriendshipStatus.PENDING::equals)
                .map(status -> NotificationEligibilityResponse.allow())
                .orElseGet(() -> NotificationEligibilityResponse.deny(REASON_REQUEST_RESOLVED));
    }
}
