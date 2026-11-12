package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.auth.service.AuthSessionService;
import com.oneorthree.phone.internal.dto.ReportSubmissionRequest;
import com.oneorthree.phone.report.dto.ReportReceipt;
import com.oneorthree.phone.report.service.ReportService;
import com.oneorthree.phone.user.repository.UserQueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.UUID;

/** users → session 잠금으로 로그아웃·탈퇴와 신고 접수/재시도를 같은 순서로 확정한다. */
@Service
@RequiredArgsConstructor
public class InternalReportService {
    private final UserQueryService users;
    private final AuthSessionService sessions;
    private final ReportService reports;

    @Transactional
    public ReportReceipt submit(UUID userId, ReportSubmissionRequest body) {
        var user = users.getCallerForUpdate(userId);
        sessions.requireActive(userId, user.getAuthGeneration(), body.sessionId(), body.authGeneration());
        return reports.submit(userId, body.report());
    }
}
