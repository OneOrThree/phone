package com.oneorthree.phone.currency.dto;

import com.oneorthree.phone.currency.repository.domain.CurrencyTransactionType;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * 재화 원장 한 줄. amount 는 방향과 무관하게 항상 양수이므로,
 * 적립인지 사용인지는 type 을 보고 판단해야 한다.
 */
@Getter
@NoArgsConstructor
@AllArgsConstructor
public class TransactionsResponse {
    int amount;
    CurrencyTransactionType type;
    Instant createdAt;
}
