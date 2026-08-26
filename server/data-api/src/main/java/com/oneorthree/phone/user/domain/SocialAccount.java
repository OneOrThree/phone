package com.oneorthree.phone.user.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.util.UUID;

@Entity
/**
 * (provider, provider_id) 전체 유니크 — 중복 가입 방어이자 조회 인덱스 (GROMO-581).
 * deleted_at 미포함(부분 아님): soft-delete row와도 충돌해야 로그인의 재활성화 로직이 성립.
 */
@Table(name = "social_accounts",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_social_accounts_provider_id",
                columnNames = {"provider", "provider_id"}))
@Getter
@Setter
@Builder
@AllArgsConstructor
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SocialAccount {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Provider provider;

    @Column(name = "provider_id", nullable = false)
    private String providerId;

    /**
     * 연동 생성 시각 — schema.dbml 의 created_at 컬럼과 매핑.
     */
    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Instant createdAt;

    /**
     * 소프트 딜리트 컬럼(연동 해제 시각) — 스키마 정합용(GROMO-561). 세팅/필터 배선은 후속 티켓.
     */
    private Instant deletedAt;
}
