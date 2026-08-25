package com.oneorthree.phone.currency.api;

import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.currency.api.docs.InGameCurrencyControllerDocs;
import com.oneorthree.phone.currency.service.InGameCurrencyService;
import com.oneorthree.phone.currency.dto.CurrencyRequest;
import com.oneorthree.phone.currency.dto.TransactionsResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * 인게임 재화 API. Swagger 애노테이션은 {@link InGameCurrencyControllerDocs} 로 분리했다(GROMO-1621).
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class InGameCurrencyController implements InGameCurrencyControllerDocs {

    private final InGameCurrencyService inGameCurrencyService;

    @Override
    @GetMapping("/currency")
    public ResponseEntity<Integer> getCurrencyBalance(@LoginUser UUID userId) {
        return ResponseEntity.ok(inGameCurrencyService.getCurrencyBalance(userId));
    }

    @Override
    @GetMapping("/currency/transactions")
    public ResponseEntity<List<TransactionsResponse>> getCurrencyTransactions(
            @LoginUser UUID userId) {
        return ResponseEntity.ok(inGameCurrencyService.getCurrencyTransactions(userId));
    }

    @Override
    @PostMapping("/currency/earn")
    public ResponseEntity<Void> earnCurrency(
            @LoginUser UUID userId,
            @RequestBody CurrencyRequest body) {
        inGameCurrencyService.earnCurrency(userId, body.getType(), body.getAmount());
        return ResponseEntity.noContent().build();
    }

    @Override
    @PostMapping("/currency/spend")
    public ResponseEntity<Void> spendCurrency(
            @LoginUser UUID userId,
            @RequestBody CurrencyRequest body) {
        inGameCurrencyService.spendCurrency(userId, body.getType(), body.getAmount());
        return ResponseEntity.noContent().build();
    }
}
