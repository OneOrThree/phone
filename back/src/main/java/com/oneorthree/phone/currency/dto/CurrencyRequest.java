package com.oneorthree.phone.currency.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@AllArgsConstructor
@NoArgsConstructor
public class CurrencyRequest {
    private int amount;

    // GROMO-671 이 서버 필드를 reason → type 으로 리네임했지만 앱(CoinContext)은 계속 { reason: ... } 으로
    // 보낸다 — alias 가 없으면 type 이 null 로 역직렬화돼 spend 는 전건 400(ILLEGAL_SPEND_REASON), 구 earn 은
    // NPE 500 이었다(리네임 배포 후 실측). 구·신 앱 페이로드를 모두 받도록 reason 을 별칭으로 흡수한다.
    @JsonAlias("reason")
    private CurrencyTransactionType type;
}
