package com.oneorthree.phone.currency.dto;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * CurrencyRequest 역직렬화 계약 — 앱 페이로드 호환을 고정한다.
 *
 * <p>GROMO-671 이 서버 필드를 reason → type 으로 리네임했지만 앱(CoinContext)은 계속
 * {@code { amount, reason }} 으로 보낸다. alias 흡수가 없으면 type=null 로 역직렬화돼
 * spend 전건 400·구 earn NPE 500 이 재발하므로 두 키 모두를 테스트로 못 박는다.
 */
class CurrencyRequestTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    @DisplayName("앱 구 페이로드 { amount, reason } → type 으로 역직렬화(alias)")
    void deserializesLegacyReasonField() throws Exception {
        CurrencyRequest request = objectMapper.readValue(
                "{\"amount\":300,\"reason\":\"PURCHASE\"}", CurrencyRequest.class);

        assertThat(request.getAmount()).isEqualTo(300);
        assertThat(request.getType()).isEqualTo(CurrencyTransactionType.PURCHASE);
    }

    @Test
    @DisplayName("정식 필드 { amount, type } 역직렬화 유지")
    void deserializesTypeField() throws Exception {
        CurrencyRequest request = objectMapper.readValue(
                "{\"amount\":50,\"type\":\"SESSION_COMPLETE\"}", CurrencyRequest.class);

        assertThat(request.getAmount()).isEqualTo(50);
        assertThat(request.getType()).isEqualTo(CurrencyTransactionType.SESSION_COMPLETE);
    }
}
