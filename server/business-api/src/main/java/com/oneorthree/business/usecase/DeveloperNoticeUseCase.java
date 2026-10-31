package com.oneorthree.business.usecase;

import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataIslandClient;
import com.oneorthree.business.upstream.data.dto.DeveloperNotices;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.UUID;

/** 소식 공개 기간은 Data가 판정하며 누락된 응답은 성공으로 합성하지 않는다. */
@Service
@RequiredArgsConstructor
public class DeveloperNoticeUseCase {
    private final DataIslandClient data;

    public DeveloperNotices.Page list(UUID userId, Deadline deadline) {
        return required(data.fetchDeveloperNotices(userId, deadline));
    }

    public DeveloperNotices.Notice get(UUID userId, UUID publicationId, Deadline deadline) {
        return required(data.fetchDeveloperNotice(userId, publicationId, deadline));
    }

    public DeveloperNotices.AppRequirement appRequirement(String platform, Deadline deadline) {
        return required(data.fetchAppRequirement(platform, deadline));
    }

    private static <T> T required(T value) {
        if (value == null) {
            throw new UpstreamContractMismatchException("개발자 소식 응답이 없습니다");
        }
        return value;
    }
}
