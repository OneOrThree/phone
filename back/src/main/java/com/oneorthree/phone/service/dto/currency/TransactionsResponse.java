package com.oneorthree.phone.service.dto.currency;

import com.oneorthree.phone.domain.reward.CurrencyReason;
import com.oneorthree.phone.domain.reward.TransactionType;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class TransactionsResponse {
    int amount;
    TransactionType type;
    CurrencyReason reason;
    Instant transactedAt;
}
