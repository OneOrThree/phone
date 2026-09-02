package com.oneorthree.phone.user.repository.domain;

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

/**
 * 코인 지갑. PK 가 곧 유저 id 인 1:1 행이고, 잔액을 바꾸는 경로는 전부 이 행을 배타 락으로 잡고 들어온다.
 *
 * <p>낙관락({@code @Version})이 남아 있지만 그것만으로는 부족해 비관 락을 함께 쓴다 — 한 트랜잭션이
 * 여러 참가자의 환불을 한꺼번에 처리하는 경로에서 낙관락 충돌은 <b>트랜잭션 전체 롤백</b>이 되기 때문이다.
 * 여러 지갑을 잡을 때는 반드시 userId 오름차순으로 접근한다(전역 락 순서).
 */
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

    /**
     * GROMO-671: dbml 은 version 을 누락했으나, spendCurrency 동시성(이중 차감) 방지에 낙관락이 필요해 유지.
     * 대체 동시성 전략(비관락 등)이 정해지기 전까지 드롭하지 않는다.
     */
    @Version
    @Builder.Default
    private Long version = 0L;

    @UpdateTimestamp
    private Instant updatedAt;

    /**
     * 소프트 딜리트 컬럼 — 스키마 정합용(GROMO-561). 현재 withdraw()는 하드 삭제(deleteById)이며,
     * 재화 이력 보존을 위한 소프트 딜리트 전환·조회 필터는 후속 티켓 범위. 아직 세팅/필터 배선 없음.
     */
    private Instant deletedAt;

    /**
     * 잔액 적립. 부호를 뒤집어 차감에 쓰는 걸 막으려고 0 이하를 거부한다.
     *
     * @param amount 더할 코인. 0 이하면 {@link IllegalArgumentException}
     */
    public void earn(int amount) {
        if (amount <= 0) {
            throw new IllegalArgumentException("잔액 증가는 양수 단위로만 되어야 합니다.");
        }
        this.balance += amount;
    }

    /**
     * 잔액 차감. 잔액이 모자라면 차감하지 않고 도메인 예외로 거절한다 — 음수 잔액은 만들지 않는다.
     *
     * @param amount 뺄 코인. 0 이하면 {@link IllegalArgumentException},
     *               잔액보다 크면 {@code CurrencyErrorCode.INSUFFICIENT_CURRENCY}
     */
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
