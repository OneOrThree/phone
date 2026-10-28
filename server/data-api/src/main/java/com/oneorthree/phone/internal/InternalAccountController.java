package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.AccountMeView;
import com.oneorthree.phone.internal.dto.AccountPatchRequest;
import com.oneorthree.phone.internal.dto.AccountProfileView;
import com.oneorthree.phone.internal.service.InternalAccountService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.UUID;

/**
 * 공개 {@code GET|PATCH|DELETE /me} 의 상류 (GROMO-1801 · B26 사용자 축 규칙 → {@code /internal/users/{userId}}).
 *
 * <p>주체는 {@code InternalAuthFilter} 가 경로와 대조한 {@code X-User-Id} 다. 세션 증명(sid·gen)은 Business 가
 * 서명된 AT 에서 꺼낸 값을 헤더로 싣는다 — GET 본문을 쓰지 않고 URL 에 남기지 않으려고 세 계약이 같은 모양이다.
 */
@RestController
@RequiredArgsConstructor
public class InternalAccountController {

    private static final String SESSION = "X-Session-Id";
    private static final String GENERATION = "X-Auth-Generation";

    private final InternalAccountService account;

    /** 계정 projection (LLD §2.2). */
    @GetMapping("/internal/users/{userId}")
    public AccountMeView me(@PathVariable UUID userId, @RequestHeader(SESSION) UUID sessionId,
                            @RequestHeader(GENERATION) long authGeneration) {
        return account.me(userId, sessionId, authGeneration);
    }

    /** 이름 변경 (LLD §2.3). 앱 키를 그대로 공개 명령 receipt 에 쓴다. */
    @PatchMapping("/internal/users/{userId}")
    public AccountProfileView patch(@PathVariable UUID userId, @RequestHeader(SESSION) UUID sessionId,
                                    @RequestHeader(GENERATION) long authGeneration,
                                    @RequestHeader("Idempotency-Key") UUID idempotencyKey,
                                    @RequestBody AccountPatchRequest body) {
        return account.patch(userId, body, sessionId, authGeneration, idempotencyKey);
    }

    /** 탈퇴 (LLD §2.5). confirmation·키 형식은 Business 가 검증했다. */
    @DeleteMapping("/internal/users/{userId}")
    public Map<String, Boolean> withdraw(@PathVariable UUID userId, @RequestHeader(SESSION) UUID sessionId,
                                         @RequestHeader(GENERATION) long authGeneration) {
        account.withdraw(userId, sessionId, authGeneration);
        return Map.of("deleted", true);
    }
}
