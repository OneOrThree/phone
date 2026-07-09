package com.oneorthree.phone.group.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.MapsId;
import jakarta.persistence.OneToOne;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

// GROMO-672: 그룹 참가 코드를 groups(code/code_expires_at)에서 1:1 테이블로 분리.
// PK=group_id(FK, @MapsId). 발급·만료·재발급을 이 엔티티가 소유(추후 Redis TTL 이관 시 캐시 경계).
@Entity
@Table(name = "group_join_codes")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class GroupJoinCode {

    @Id
    @Column(name = "group_id")
    private UUID groupId;

    @MapsId
    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "group_id", nullable = false)
    private Group group;

    @Column(nullable = false, unique = true, length = 8)
    private String code;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    @Builder.Default
    private GroupJoinCodeStatus status = GroupJoinCodeStatus.ACTIVE;

    @Column(name = "expires_at")
    private Instant expiresAt;

    @CreationTimestamp
    private Instant createdAt;

    @UpdateTimestamp
    private Instant updatedAt;

    public void renew(String newCode) {
        this.code = newCode;
        this.status = GroupJoinCodeStatus.ACTIVE;
        this.expiresAt = Instant.now().plus(3, ChronoUnit.HOURS);
    }

    public void expire() {
        this.status = GroupJoinCodeStatus.ENDED;
    }
}
