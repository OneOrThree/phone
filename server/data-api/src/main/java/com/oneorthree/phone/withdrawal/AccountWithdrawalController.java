package com.oneorthree.phone.withdrawal;

import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.withdrawal.service.AccountWithdrawalService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 회원 탈퇴 API (GROMO-1656 에서 {@code UserController} 로부터 분리).
 *
 * <p><b>경로는 그대로 {@code DELETE /api/v1/users/me} 다</b> — 앱이 쓰는 계약이라 바뀌면 안 된다.
 * 클래스만 옮긴 이유는 탈퇴가 여섯 도메인을 순서대로 정리하는 오케스트레이션이라
 * ({@link AccountWithdrawalService}) 그 진입점이 계정 도메인 안에 있으면 user 가 자기 위의
 * 도메인들을 참조하게 되기 때문이다. Swagger 태그도 {@code user} 로 동일하다.
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class AccountWithdrawalController implements AccountWithdrawalControllerDocs {

    private final AccountWithdrawalService accountWithdrawalService;

    @Override
    @DeleteMapping("/users/me")
    public ResponseEntity<Void> withdraw(@LoginUser UUID userId) {
        accountWithdrawalService.withdraw(userId);
        return ResponseEntity.noContent().build();
    }
}
