package com.oneorthree.phone.currency;

import com.oneorthree.phone.currency.dto.CurrencyRequest;
import com.oneorthree.phone.currency.dto.TransactionsResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;

import java.util.List;
import java.util.UUID;

/**
 * {@code InGameCurrencyController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 */
@Tag(name = "currency", description = "인게임 재화 관련 API")
public interface InGameCurrencyControllerDocs {

    @Operation(summary = "잔액 조회", description = "유저의 현재 인게임 잔액 조회")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Integer> getCurrencyBalance(UUID userId);

    @Operation(summary = "거래 내역 조회", description = "유저의 거래 내역 조회")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<List<TransactionsResponse>> getCurrencyTransactions(UUID userId);

    @Operation(summary = "적립 (폐쇄 — no-op)",
            description = "currency 폐쇄: 클라 주도 적립은 코인 민팅 악용 벡터라 무효화됐다. 세션 보상은 세션 저장"
                    + "(POST /api/v1/focus-session)에서 서버가 직접 지급하고 awardedCoins 로 응답한다. "
                    + "구앱 호환을 위해 204 는 유지하되 잔액·원장에 아무것도 반영하지 않는다.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "no-op 성공(항상 — 잔액 무변화)")
    })
    ResponseEntity<Void> earnCurrency(UUID userId, CurrencyRequest body);

    @Operation(summary = "사용", description = "인게임 재화 감소")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "사용 성공"),
        @ApiResponse(responseCode = "400", description = "잔액 부족 또는 유효하지 않은 요청"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Void> spendCurrency(UUID userId, CurrencyRequest body);
}
