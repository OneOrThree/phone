package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.HostTransferRequest;
import com.oneorthree.phone.internal.dto.HostTransferResponse;
import com.oneorthree.phone.internal.service.InternalHostTransferService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/** 내부 서비스 토큰/정확한 허용목록을 통과한 Business 위임만 받는다. 공개 라우트가 아니다. */
@RestController
@RequiredArgsConstructor
public class InternalHostTransferController {
    private final InternalHostTransferService service;

    @PostMapping("/internal/islands/{islandId}/host-transfer")
    public HostTransferResponse transfer(@PathVariable String islandId,
                                         @RequestHeader("X-User-Id") String userId,
                                         @RequestHeader("Idempotency-Key") String key,
                                         @Valid @RequestBody HostTransferRequest request) {
        return service.transfer(HostTransferRequest.identifier(islandId), HostTransferRequest.identifier(userId),
                HostTransferRequest.identifier(key), request);
    }
}
