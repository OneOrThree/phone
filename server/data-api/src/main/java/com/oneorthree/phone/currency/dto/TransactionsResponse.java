package com.oneorthree.phone.currency.dto;

import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class TransactionsResponse {
    int amount;
    CurrencyTransactionType type;
    Instant createdAt;
}
