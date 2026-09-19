package com.oneorthree.phone.currency.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.util.UUID;

/**
 * 개인 지갑(개인 물고기, 통화 {@code fish}) — 2026-09-18 결정 D1 「개인 지갑 + 섬 통장 둘 다」의 개인 쪽
 * (GROMO-1924 에서 집중 보상의 개인 몫을 받으려고 처음 만든다).
 *
 * <p><b>코인 지갑({@code user_wallets})과 다른 행이다.</b> 결정 D11 이 「기존 코인 잔액 이관 안 함」이라
 * 개인 물고기는 0 에서 시작하는 새 잔액이고, 1.x 코인·상점·내기 경로는 이 행을 모른다. 원장은 따로 두지
 * 않는다 — 지금 적립 경로가 집중 정산 하나뿐이라 세션당 1행인 {@code focus_settlements} 가 그 근거다.
 * 차감(개인 상점)이 생기는 날 원장을 함께 만든다.
 *
 * <p>잠금 규율은 다른 지갑과 같다 — 잔액을 바꾸는 경로만 이 행을 배타로 잡는다.
 */
@Entity
@Table(name = "user_fish_wallets")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class UserFishWallet {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(nullable = false)
    @Builder.Default
    private int balance = 0;

    @UpdateTimestamp
    @Column(name = "updated_at", columnDefinition = "timestamptz not null default now()")
    private Instant updatedAt;

    /** 적립. 부호를 뒤집어 차감에 쓰는 걸 막으려고 0 이하를 거부한다. int 넘침은 조용히 감싸지 않고 던진다. */
    public void earn(int amount) {
        if (amount <= 0) {
            throw new IllegalArgumentException("잔액 증가는 양수 단위로만 되어야 합니다.");
        }
        this.balance = Math.addExact(this.balance, amount);
    }
}
