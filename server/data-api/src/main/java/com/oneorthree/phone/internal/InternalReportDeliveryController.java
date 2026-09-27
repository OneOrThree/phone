package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.ReportDeliveryClaimRequest;
import com.oneorthree.phone.internal.dto.ReportDeliveryCompleteRequest;
import com.oneorthree.phone.internal.dto.ReportDeliveryLeaseRequest;
import com.oneorthree.phone.internal.dto.ReportDeliveryPrepareRequest;
import com.oneorthree.phone.internal.dto.ReportDeliveryView;
import com.oneorthree.phone.internal.service.InternalReportDeliveryService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/** Business의 신고 메일 전달 workflow 전용 내부 표면. */
@RestController
@RequestMapping("/internal/users/{userId}/report-deliveries/{requestId}")
@RequiredArgsConstructor
public class InternalReportDeliveryController {

    private final InternalReportDeliveryService deliveries;

    @PostMapping("/claim")
    public ReportDeliveryView claim(@PathVariable UUID userId, @PathVariable UUID requestId,
            @Valid @RequestBody ReportDeliveryClaimRequest request) {
        return deliveries.claim(userId, requestId, request);
    }

    @PostMapping("/prepare")
    public ReportDeliveryView prepare(@PathVariable UUID userId, @PathVariable UUID requestId,
            @Valid @RequestBody ReportDeliveryPrepareRequest request) {
        return deliveries.prepare(userId, requestId, request);
    }

    @PostMapping("/complete")
    public ReportDeliveryView complete(@PathVariable UUID userId, @PathVariable UUID requestId,
            @Valid @RequestBody ReportDeliveryCompleteRequest request) {
        return deliveries.complete(userId, requestId, request.leaseToken(), request.blocked());
    }

    @PostMapping("/renew")
    public ReportDeliveryView renew(@PathVariable UUID userId, @PathVariable UUID requestId,
            @Valid @RequestBody ReportDeliveryLeaseRequest request) {
        return deliveries.renew(userId, requestId, request.leaseToken());
    }

    @PostMapping("/email-confirmed")
    public ReportDeliveryView emailConfirmed(@PathVariable UUID userId, @PathVariable UUID requestId,
            @Valid @RequestBody ReportDeliveryLeaseRequest request) {
        return deliveries.emailConfirmed(userId, requestId, request.leaseToken());
    }

    @PostMapping("/release")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void release(@PathVariable UUID userId, @PathVariable UUID requestId,
            @Valid @RequestBody ReportDeliveryLeaseRequest request) {
        deliveries.release(userId, requestId, request.leaseToken());
    }
}
