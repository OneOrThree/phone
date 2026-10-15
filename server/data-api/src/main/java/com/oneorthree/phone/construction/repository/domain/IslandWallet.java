package com.oneorthree.phone.construction.repository.domain;

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
 * 섬 공동 지갑 (정책 C05, D1) — 서버 통화 식별자는 {@code village_points} 다.
 * 개인 물고기({@code user_fish_wallets}, GROMO-1924)와 다른 축이며, 개인 fish 를 대신 차감하지 않는다.
 *
 * <p>PK 가 곧 섬 id 인 1:1 행이고, 잔액을 바꾸는 경로는 이 행을 배타 락으로 잡고 들어온다
 * ({@code user_wallets} 와 같은 방식). 잔액 표시용 읽기는 락 없이 해도 된다.
 */
@Entity
@Table(name = "island_wallets")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class IslandWallet {

    @Id
    @Column(name = "island_id")
    private UUID islandId;

    @Column(nullable = false)
    @Builder.Default
    private int balance = 0;

    @Version
    @Builder.Default
    private Long version = 0L;

    @UpdateTimestamp
    private Instant updatedAt;

    /** 새 섬의 0원 지갑 — 생성 시점에 함께 만든다. */
    public static IslandWallet empty(UUID islandId) {
        return IslandWallet.builder().islandId(islandId).balance(0).build();
    }

    /**
     * 잔액 적립. 부호를 뒤집어 차감에 쓰는 걸 막으려고 0 이하를 거부한다.
     */
    public void earn(int amount) {
        if (amount <= 0) {
            throw new IllegalArgumentException("잔액 증가는 양수 단위로만 되어야 합니다.");
        }
        this.balance += amount;
    }

    /**
     * 잔액 차감 시도 — 모자라면 <b>아무것도 바꾸지 않고</b> {@code false} 를 돌려준다.
     * 「모자라다」를 어떤 실패로 보고할지는 호출측(서비스)이 정한다
     * ({@code UserWallet#trySpend} 와 같은 계약, GROMO-1656).
     */
    public boolean trySpend(int amount) {
        if (amount <= 0) {
            throw new IllegalArgumentException("잔액 감소는 양수 단위로만 되어야 합니다.");
        }
        if (this.balance < amount) {
            return false;
        }
        this.balance -= amount;
        return true;
    }
}
