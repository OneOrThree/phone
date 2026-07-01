package com.oneorthree.phone.user.domain;

import com.oneorthree.phone.currency.exception.CurrencyErrorCode;
import com.oneorthree.phone.currency.exception.CurrencyException;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "user_wallets")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class UserWallet {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(nullable = false)
    @Builder.Default
    private int balance = 0;

    @Version
    @Builder.Default
    private Long version = 0L;

    @UpdateTimestamp
    private Instant updatedAt;

    // 소프트 딜리트 컬럼 — 스키마 정합용(GROMO-561). 현재 withdraw()는 하드 삭제(deleteById)이며,
    // 재화 이력 보존을 위한 소프트 딜리트 전환·조회 필터는 후속 티켓 범위. 아직 세팅/필터 배선 없음.
    private Instant deletedAt;

    public void earn(int amount) {
        if (amount <= 0) {
            throw new IllegalArgumentException("잔액 증가는 양수 단위로만 되어야 합니다.");
        }
        this.balance += amount;
    }

    public void spend(int amount) {
        if (amount <= 0) {
            throw new IllegalArgumentException("잔액 감소는 양수 단위로만 되어야 합니다.");
        }
        if (this.balance < amount) {
            throw new CurrencyException(CurrencyErrorCode.INSUFFICIENT_CURRENCY);
        }
        this.balance -= amount;
    }
}
