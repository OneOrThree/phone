package com.oneorthree.phone.currency.service;

import com.oneorthree.phone.currency.repository.UserFishWalletRepository;
import com.oneorthree.phone.currency.repository.domain.UserFishWallet;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * 개인 물고기 지갑 (GROMO-1924, D1) — 코인 원장({@link CurrencyLedgerService})과 다른 통화다.
 *
 * <p>{@code MANDATORY} 인 이유는 섬 지갑({@code IslandWalletService})과 같다 — 지갑은 잠금 순서의 뒤쪽
 * (섬·상세·섬 지갑 다음)이라 호출측 트랜잭션 안에서만 잡는다.
 */
@Service
@RequiredArgsConstructor
@Transactional(propagation = Propagation.MANDATORY)
public class FishWalletService {

    private final UserFishWalletRepository wallets;

    /**
     * 적립 — 멱등은 호출측이 보장한다(집중 정산은 세션당 1행인 정산 PK 가 막는다).
     *
     * @return 적립 후 잔액
     */
    public int credit(UUID userId, int amount) {
        wallets.insertIfAbsent(userId);
        UserFishWallet wallet = wallets.findByIdForUpdate(userId)
                .orElseThrow(() -> new IllegalStateException("개인 물고기 지갑을 만들 직후에 찾지 못했습니다."));
        wallet.earn(amount);
        return wallet.getBalance();
    }
}
