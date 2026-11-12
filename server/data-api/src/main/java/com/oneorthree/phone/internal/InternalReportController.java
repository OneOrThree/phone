package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.ReportSubmissionRequest;
import com.oneorthree.phone.internal.service.InternalReportService;
import com.oneorthree.phone.report.dto.ReportReceipt;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import java.util.UUID;

/** 사용자 신고 접수만 제공한다. 다른 사용자 신고 목록·상태 조회는 열지 않는다. */
@RestController
@RequiredArgsConstructor
public class InternalReportController {
    private final InternalReportService reports;

    @PostMapping("/internal/users/{userId}/reports")
    public ReportReceipt submit(@PathVariable UUID userId, @Valid @RequestBody ReportSubmissionRequest body) {
        return reports.submit(userId, body);
    }
}
