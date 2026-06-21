package com.oneorthree.phone.currency.api;

import com.oneorthree.phone.currency.service.InGameCurrencyService;
import com.oneorthree.phone.currency.dto.CurrencyRequest;
import com.oneorthree.phone.currency.dto.TransactionsResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@Tag(name = "currency", description = "인게임 재화 관련 API")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class InGameCurrencyController {

    private final InGameCurrencyService inGameCurrencyService;

    @Operation(summary = "잔액 조회", description = "유저의 현재 인게임 잔액 조회")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    @GetMapping("/currency")
    public ResponseEntity<Integer> getCurrencyBalance(HttpServletRequest request) {
        Long userId = (Long) request.getAttribute("userId");
        return ResponseEntity.ok(inGameCurrencyService.getCurrencyBalance(userId));
    }

    @Operation(summary = "거래 내역 조회", description = "유저의 거래 내역 조회")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    @GetMapping("/currency/transactions")
    public ResponseEntity<List<TransactionsResponse>> getCurrencyTransactions(
            HttpServletRequest request) {
        Long userId = (Long) request.getAttribute("userId");
        return ResponseEntity.ok(inGameCurrencyService.getCurrencyTransactions(userId));
    }

    @Operation(summary = "적립", description = "인게임 재화 증가")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "적립 성공"),
        @ApiResponse(responseCode = "400", description = "유효하지 않은 요청"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    @PostMapping("/currency/earn")
    public ResponseEntity<Void> earnCurrency(
            HttpServletRequest request,
            @RequestBody CurrencyRequest body) {
        Long userId = (Long) request.getAttribute("userId");
        inGameCurrencyService.earnCurrency(userId, body.getReason(), body.getAmount());
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "사용", description = "인게임 재화 감소")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "사용 성공"),
        @ApiResponse(responseCode = "400", description = "잔액 부족 또는 유효하지 않은 요청"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    @PostMapping("/currency/spend")
    public ResponseEntity<Void> spendCurrency(
            HttpServletRequest request,
            @RequestBody CurrencyRequest body) {
        Long userId = (Long) request.getAttribute("userId");
        inGameCurrencyService.spendCurrency(userId, body.getReason(), body.getAmount());
        return ResponseEntity.noContent().build();
    }
}
