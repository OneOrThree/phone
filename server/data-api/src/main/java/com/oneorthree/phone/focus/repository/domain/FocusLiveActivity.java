package com.oneorthree.phone.focus.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import com.oneorthree.phone.focus.dto.session.LiveActivityRegistration;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

/** 단일 기기 정책: 집중 세션당 최신 Activity 하나. 성공 버전은 재시작 뒤에도 보존한다. */
@Entity
@Table(name = "focus_live_activities")
@Getter
@NoArgsConstructor
public class FocusLiveActivity {
    @Id
    @GeneratedUuidV7
    private UUID id;
    @Column(nullable = false, unique = true)
    private UUID sessionId;
    @Column(nullable = false)
    private UUID userId;
    @Column(nullable = false, length = 128)
    private String activityId;
    @Column(nullable = false, length = 1024)
    private String pushToken;
    @Column(nullable = false, length = 16)
    private String environment;
    @Column(nullable = false, length = 16)
    private String catColor;
    @Column(nullable = false)
    private long sentVersion;
    @Column(nullable = false)
    private long sentTimestamp;
    @Column(nullable = false)
    private Instant nextAttemptAt;
    @Column(nullable = false)
    private Instant expiresAt;

    public FocusLiveActivity(UUID sessionId, UUID userId, LiveActivityRegistration request, Instant now) {
        this.sessionId = sessionId;
        this.userId = userId;
        register(request, now);
    }

    public void register(LiveActivityRegistration request, Instant now) {
        boolean changed = !request.pushToken().equals(pushToken) || !request.catColor().equals(catColor)
                || !request.environment().equals(environment) || !request.activityId().equals(activityId);
        if (!request.activityId().equals(activityId)) {
            expiresAt = now.plusSeconds(8 * 60 * 60);
        }
        activityId = request.activityId();
        pushToken = request.pushToken();
        environment = request.environment();
        catColor = request.catColor();
        if (changed) {
            sentVersion = -1;
            nextAttemptAt = now;
        }
    }

    public void attempted(Instant next) {
        nextAttemptAt = next;
    }

    public void sent(long version, long timestamp) {
        sentVersion = version;
        sentTimestamp = timestamp;
    }
}
