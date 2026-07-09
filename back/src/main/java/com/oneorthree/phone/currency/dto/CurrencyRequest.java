package com.oneorthree.phone.currency.dto;

import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@AllArgsConstructor
@NoArgsConstructor
public class CurrencyRequest {
    private int amount;
    private CurrencyTransactionType type;
}
