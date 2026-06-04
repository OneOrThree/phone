package com.oneorthree.phone.service.dto.currency;

import com.oneorthree.phone.domain.reward.CurrencyReason;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@AllArgsConstructor
@NoArgsConstructor
public class CurrencyRequest {
    private int amount;
    private CurrencyReason reason;
}
