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

    /**
     * 지갑의 현재 잔액을 돌려준다.
     *
     * @param userId 조회 대상 로그인 유저
     * @return 코인 잔액. 원장을 합산하지 않고 지갑 행의 값을 그대로 읽으므로 원장과 어긋나면 이쪽이 정본이다
     */
    @Operation(summary = "잔액 조회", description = "유저의 현재 인게임 잔액 조회")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Integer> getCurrencyBalance(UUID userId);

    /**
     * 재화 변동 원장을 최신순으로 돌려준다.
     *
     * @param userId 조회 대상 로그인 유저
     * @return 적립·사용 기입 전체(페이지네이션 없음). 금액은 방향과 무관하게 항상 양수이고,
     *         증감 방향은 type 으로 읽어야 한다
     */
    @Operation(summary = "거래 내역 조회", description = "유저의 거래 내역 조회")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<List<TransactionsResponse>> getCurrencyTransactions(UUID userId);

    /**
     * 폐쇄된 적립 엔드포인트. 클라 주도 적립은 임의 금액 발행 통로라 무효화됐고,
     * 세션 보상은 세션 저장 시 서버가 직접 지급한다.
     *
     * @param userId 요청자 — 호출 잔존 추적 로그에만 쓰인다
     * @param body   구앱이 보내는 금액·사유. 값을 읽기만 하고 잔액·원장에는 반영하지 않는다
     * @return 항상 204. 구앱이 실패로 오인하지 않도록 성공 코드를 유지할 뿐 아무것도 바뀌지 않는다
     */
    @Operation(summary = "적립 (폐쇄 — no-op)",
            description = "currency 폐쇄: 클라 주도 적립은 코인 민팅 악용 벡터라 무효화됐다. 세션 보상은 세션 저장"
                    + "(POST /api/v1/focus-session)에서 서버가 직접 지급하고 awardedCoins 로 응답한다. "
                    + "구앱 호환을 위해 204 는 유지하되 잔액·원장에 아무것도 반영하지 않는다.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "no-op 성공(항상 — 잔액 무변화)")
    })
    ResponseEntity<Void> earnCurrency(UUID userId, CurrencyRequest body);

    /**
     * 잔액을 차감하고 원장에 사용 기입을 남긴다.
     *
     * @param userId 차감 대상 로그인 유저
     * @param body   차감 금액과 사유. 클라 경로에서 허용되는 사유는 PURCHASE 뿐이고,
     *               서버 전용 타입(BET_*·보상류)을 실어 보내면 400 으로 거절된다
     * @return 본문 없는 204. 잔액이 모자라면 차감·기입이 함께 롤백되고 400 이 나가므로 잔액은 음수가 되지 않는다
     */
    @Operation(summary = "사용", description = "인게임 재화 감소")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "사용 성공"),
        @ApiResponse(responseCode = "400", description = "잔액 부족 또는 유효하지 않은 요청"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Void> spendCurrency(UUID userId, CurrencyRequest body);
}
