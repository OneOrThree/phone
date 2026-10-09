package com.oneorthree.phone.focus.service;

import com.oneorthree.phone.focus.client.LiveActivityPushClient;
import com.oneorthree.phone.focus.dto.session.LiveActivityRegistration;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.focus.repository.FocusLiveActivityQueryService;
import com.oneorthree.phone.focus.repository.FocusLiveActivityRepository;
import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.repository.domain.FocusLiveActivity;
import com.oneorthree.phone.focus.support.LiveActivityContent;
import com.oneorthree.phone.user.repository.UserQueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class FocusLiveActivityService {
    private final FocusLiveActivityRepository activities;
    private final FocusLiveActivityQueryService sessions;
    private final FocusSessionIntervalRepository intervals;
    private final LiveActivityPushClient push;
    private final Clock clock;
    private final UserQueryService users;

    @Transactional
    public void register(UUID userId, UUID sessionId, LiveActivityRegistration request) {
        if (request == null) {
            throw new FocusException(FocusErrorCode.INVALID_LIVE_ACTIVITY);
        }
        request.validate();
        // 사용자 → 세션 → Activity 순서. 탈퇴와 FK 등록의 잠금 순서도 일치시킨다.
        users.getCallerForShare(userId);
        var detail = sessions.requireForUpdate(sessionId);
        if (!userId.equals(detail.getUserId())) {
            throw new FocusException(FocusErrorCode.FORBIDDEN);
        }
        Instant now = clock.instant();
        var activity = activities.findBySessionIdForUpdate(sessionId).orElse(null);
        if (activity == null) {
            activities.save(new FocusLiveActivity(sessionId, userId, request, now));
        } else {
            activity.register(request, now);
        }
        // 종료 직전 등록도 허용한다. 다음 전송에서 end를 보내 잔존 표시를 없앤다.
    }

    @Transactional
    public void deliver(UUID sessionId) {
        // 등록과 동일한 잠금 순서. 전송 도중 새 전이가 끼어들어 과거 상태를 보내지 않는다.
        var detail = sessions.requireForUpdate(sessionId);
        var activity = activities.findBySessionIdForUpdate(sessionId).orElse(null);
        if (activity == null) {
            return;
        }
        Instant now = clock.instant();
        if (!now.isBefore(activity.getExpiresAt())) {
            activities.delete(activity);
            return;
        }
        if (now.isBefore(activity.getNextAttemptAt())) {
            return;
        }
        activity.attempted(now.plusSeconds(15));
        if (activity.getSentVersion() == detail.getVersion() && !LiveActivityContent.ended(detail)) {
            return;
        }
        if (!push.enabled() || now.getEpochSecond() <= activity.getSentTimestamp()) {
            return;
        }
        long timestamp = now.getEpochSecond();
        var payload = LiveActivityContent.payload(detail,
                intervals.findBySessionIdOrderByOrdinalAsc(sessionId), activity.getCatColor(), timestamp, now);
        var result = push.send(activity.getPushToken(), activity.getEnvironment(), payload);
        if (result == LiveActivityPushClient.Result.INVALID_TOKEN
                || (result == LiveActivityPushClient.Result.SENT && LiveActivityContent.ended(detail))) {
            activities.delete(activity);
        } else if (result == LiveActivityPushClient.Result.SENT) {
            activity.sent(detail.getVersion(), timestamp);
        }
    }
}
