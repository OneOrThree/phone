package com.oneorthree.phone.report.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.NoArgsConstructor;
import java.time.Instant;
import java.util.UUID;

/** 개인정보를 포함하므로 toString과 일반 사용자 조회 DTO를 만들지 않는다. */
@Entity
@Table(name = "safety_reports")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SafetyReport {
    @Id
    @GeneratedUuidV7
    private UUID id;

    @Column(name = "reporter_id", nullable = false)
    private UUID reporterId;

    @Column(name = "request_id", nullable = false)
    private UUID requestId;

    @Column(name = "target_type", nullable = false, length = 32)
    private String targetType;

    @Column(name = "target_id", nullable = true)
    private UUID targetId;

    @Column(name = "target_user_id", nullable = true)
    private UUID targetUserId;

    @Column(name = "reason", nullable = false, length = 32)
    private String reason;

    @Column(name = "details", nullable = false, length = 2000)
    private String details;

    @Column(name = "submitted_text", nullable = true, length = 5000)
    private String submittedText;

    @Column(name = "received_at", nullable = false)
    private Instant receivedAt;

    @Column(name = "status", nullable = false, length = 16)
    private String status;

    @Column(name = "resolution", nullable = true, length = 2000)
    private String resolution;

    @Column(name = "resolved_by", nullable = true, length = 64)
    private String resolvedBy;

    @Column(name = "closed_at", nullable = true)
    private Instant closedAt;

    @Column(name = "legal_hold", nullable = false)
    private boolean legalHold;

    @Column(name = "hold_reason", nullable = true, length = 1000)
    private String holdReason;
}
