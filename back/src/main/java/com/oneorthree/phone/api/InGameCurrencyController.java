package com.oneorthree.phone.api;

import com.oneorthree.phone.service.InGameCurrencyService;
import com.oneorthree.phone.service.dto.currency.CurrencyRequest;
import com.oneorthree.phone.service.dto.currency.TransactionsResponse;
import io.swagger.v3.oas.annotations.Operation;
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
    @GetMapping("/currency")
    public ResponseEntity<Integer> getCurrencyBalance(HttpServletRequest request) {
        Long userId = (Long) request.getAttribute("userId");
        return ResponseEntity.ok(inGameCurrencyService.getCurrencyBalance(userId));
    }

    @Operation(summary = "거래 내역 조회", description = "유저의 거래 내역 조회")
    @GetMapping("/currency/transactions")
    public ResponseEntity<List<TransactionsResponse>> getCurrencyTransactions(
            HttpServletRequest request) {
        Long userId = (Long) request.getAttribute("userId");
        return ResponseEntity.ok(inGameCurrencyService.getCurrencyTransactions(userId));
    }

    @Operation(summary = "적립", description = "인게임 재화 증가")
    @PostMapping("/currency/earn")
    public ResponseEntity<Void> earnCurrency(
            HttpServletRequest request,
            @RequestBody CurrencyRequest body) {
        Long userId = (Long) request.getAttribute("userId");
        inGameCurrencyService.earnCurrency(userId, body.getReason(), body.getAmount());
        return ResponseEntity.ok().build();
    }

    @Operation(summary = "사용", description = "인게임 재화 감소")
    @PostMapping("/currency/spend")
    public ResponseEntity<Void> spendCurrency(
            HttpServletRequest request,
            @RequestBody CurrencyRequest body) {
        Long userId = (Long) request.getAttribute("userId");
        inGameCurrencyService.spendCurrency(userId, body.getReason(), body.getAmount());
        return ResponseEntity.ok().build();
    }
}
