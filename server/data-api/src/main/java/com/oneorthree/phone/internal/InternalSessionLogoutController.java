package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.SessionLogoutService;
import com.oneorthree.phone.internal.dto.SessionLogoutRequest;
import com.oneorthree.phone.internal.dto.SessionLogoutResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** business caller의 exact allowlist로 보호하고 주체는 서비스가 RT 서명으로 직접 확인한다. */
@RestController
@RequiredArgsConstructor
public class InternalSessionLogoutController {
    private final SessionLogoutService service;

    @PostMapping("/internal/auth/sessions/logout")
    public SessionLogoutResponse logout(@RequestBody SessionLogoutRequest request) {
        service.logout(request.refreshToken(), request.accessToken());
        return new SessionLogoutResponse(true);
    }
}
