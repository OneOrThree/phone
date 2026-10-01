package com.oneorthree.phone.focus.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

/** 계정당 최초 낚시 보상 영수증. 세션·섬을 바꾸거나 앱을 재설치해도 다시 지급하지 않는다. */
@Entity
@Table(name = "focus_tutorial_rewards")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class FocusTutorialReward {
    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "session_id", nullable = false)
    private UUID sessionId;

    @Column(name = "claimed_at", nullable = false)
    private Instant claimedAt;
}
