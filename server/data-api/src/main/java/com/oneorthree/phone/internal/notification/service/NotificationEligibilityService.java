package com.oneorthree.phone.internal.notification.service;

import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.friend.repository.domain.FriendshipStatus;
import com.oneorthree.phone.internal.notification.dto.NotificationEligibilityRequest;
import com.oneorthree.phone.internal.notification.dto.NotificationEligibilityResponse;
import com.oneorthree.phone.notification.producer.NotificationKind;
import com.oneorthree.phone.notification.producer.NotificationExpiry;
import com.oneorthree.phone.magazine.repository.MagazineIssueRepository;
import com.oneorthree.phone.magazine.repository.domain.MagazineIssue;
import com.oneorthree.phone.magazine.support.MagazineCalendar;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.service.UserBlockService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.DateTimeException;
import java.time.Instant;
import java.util.UUID;

/** 현재 친구·섬·잡지 알림의 발송 직전 적격성을 확인한다. 폐기된 종류의 지연 봉투는 거절한다. */
@Service
@RequiredArgsConstructor
public class NotificationEligibilityService {

    static final String REASON_UNKNOWN_KIND = "UNKNOWN_KIND";
    static final String REASON_USER_INACTIVE = "USER_INACTIVE";
    static final String REASON_SUBJECT_REQUIRED = "SUBJECT_REQUIRED";
    static final String REASON_SUBJECT_GONE = "SUBJECT_GONE";
    static final String REASON_ISSUE_NOT_CURRENT = "ISSUE_NOT_CURRENT";
    static final String REASON_BLOCKED = "BLOCKED";
    static final String REASON_REQUEST_RESOLVED = "REQUEST_RESOLVED";
    static final String PARAM_REQUEST_ID = "requestId";

    private final UserQueryService userQueryService;
    private final FriendshipRepository friendshipRepository;
    private final Clock clock;
    private final UserBlockService userBlockService;
    private final MagazineIssueRepository magazineIssueRepository;

    @Transactional(readOnly = true)
    public NotificationEligibilityResponse evaluate(NotificationEligibilityRequest request) {
        NotificationKind kind = NotificationKind.find(request.kind());
        if (kind == null) {
            return NotificationEligibilityResponse.deny(REASON_UNKNOWN_KIND);
        }
        if (userQueryService.findActive(request.userId()).isEmpty()) {
            return NotificationEligibilityResponse.deny(REASON_USER_INACTIVE);
        }
        if (request.subjectId() == null) {
            return NotificationEligibilityResponse.deny(REASON_SUBJECT_REQUIRED);
        }
        NotificationEligibilityResponse expiry = checkExpiry(request, kind);
        if (expiry != null) {
            return expiry;
        }
        return switch (kind) {
            case FRIEND_REQUEST -> evaluateFriendRequest(request);
            case FRIEND_ACCEPTED -> evaluateFriendAccepted(request);
            case MAIN_ISLAND_TRANSFERRED, ISLAND_KICKED, ADMIN_ANNOUNCEMENT -> NotificationEligibilityResponse.allow();
            case MAGAZINE_PUBLISHED -> evaluateMagazinePublished(request);
        };
    }

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

    /** 지난 잡지 호의 알림은 발송하지 않는다. */
    private NotificationEligibilityResponse evaluateMagazinePublished(NotificationEligibilityRequest request) {
        MagazineIssue issue = magazineIssueRepository.findById(request.subjectId()).orElse(null);
        if (issue == null) {
            return NotificationEligibilityResponse.deny(REASON_SUBJECT_GONE);
        }
        return clock.instant().isBefore(MagazineCalendar.currentUntil(issue.getIssueDate()))
                ? NotificationEligibilityResponse.allow()
                : NotificationEligibilityResponse.deny(REASON_ISSUE_NOT_CURRENT);
    }

    /** 수락 사실은 친구 해제 뒤에도 유효하지만, 탈퇴한 상대의 보존된 닉네임은 전송하지 않는다. */
    private NotificationEligibilityResponse evaluateFriendAccepted(NotificationEligibilityRequest request) {
        if (userQueryService.findActive(request.subjectId()).isEmpty()) {
            return NotificationEligibilityResponse.deny(REASON_SUBJECT_GONE);
        }
        return blockedBetween(request) ? NotificationEligibilityResponse.deny(REASON_BLOCKED)
                : NotificationEligibilityResponse.allow();
    }

    /**
     * 친구 알림의 수신자({@code userId})와 상대({@code subjectId}) 사이에 차단이 있는가 (GROMO-2180).
     * 방향을 가리지 않는다 — 한쪽만 차단해도 새 요청·수락 알림을 보내지 않는다(RP-차단).
     */
    private boolean blockedBetween(NotificationEligibilityRequest request) {
        return userBlockService.isBlockedEither(request.userId(), request.subjectId());
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
        boolean pending = friendshipRepository.findStatusByIdAndDeletedAtIsNull(requestId)
                .filter(FriendshipStatus.PENDING::equals)
                .isPresent();
        if (!pending) {
            return NotificationEligibilityResponse.deny(REASON_REQUEST_RESOLVED);
        }
        return blockedBetween(request) ? NotificationEligibilityResponse.deny(REASON_BLOCKED)
                : NotificationEligibilityResponse.allow();
    }
}
