package com.oneorthree.phone.currency.repository.domain;

import com.oneorthree.phone.user.repository.domain.User;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.util.UUID;

/**
 * 재화 변동 원장 한 줄. {@code amount} 는 방향과 무관하게 항상 양수로 적고 증감 방향은
 * {@code type} 이 표현한다 — 잔액을 원장 합으로 재구성할 때 부호를 type 에서 끌어와야 한다.
 *
 * <p>{@code idempotencyKey} 는 유니크 제약이 걸린 중복 기입의 최후 방어선이다.
 * 클라 경로처럼 재시도 개념이 없는 기입은 이 값이 null 이다.
 */
@Entity
@Table(name = "currency_transactions")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class CurrencyTransaction {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(nullable = false)
    private int amount;

    @Enumerated(EnumType.STRING)
    @Column(name = "type", nullable = false)
    private CurrencyTransactionType type;

    @Column(name = "idempotency_key", unique = true)
    private String idempotencyKey;

    @CreationTimestamp
    @Column(name = "created_at")
    private Instant createdAt;
}
