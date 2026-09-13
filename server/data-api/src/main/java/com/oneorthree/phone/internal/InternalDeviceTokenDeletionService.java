package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.repository.AuthSessionRepository;
import com.oneorthree.phone.auth.repository.domain.AuthSession;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.user.dto.DeviceTokenDeletionRequest;
import com.oneorthree.phone.user.service.UserSatelliteCommandService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/** 검증된 AT의 세션을 삭제 범위로 해석한다. 사용자 도메인은 인증 원장을 직접 참조하지 않는다. */
@Service
@RequiredArgsConstructor
public class InternalDeviceTokenDeletionService {
    private final AuthSessionRepository sessions;
    private final UserSatelliteCommandService commands;

    /** 세션 원문의 소유자를 검사하고 불변 bootstrap 해시를 직접 전달과 outbox에 함께 보존한다. */
    @Transactional
    public EventEnvelope record(UUID user, DeviceTokenDeletionRequest request, String key) {
        String hash = null;
        if ((request.deviceToken() == null || request.deviceToken().isBlank())
                && request.ownershipToken() == null && request.sessionId() != null) {
            AuthSession session = sessions.findById(request.sessionId())
                    .filter(found -> user.equals(found.getUserId()))
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.FORBIDDEN));
            // 이미 폐기된 세션의 삭제 재요청도 같은 범위를 유지한다.
            hash = session.getBootstrapNonceHash();
        }
        return commands.recordDeviceTokenDeletion(user, request, key, hash);
    }
}
