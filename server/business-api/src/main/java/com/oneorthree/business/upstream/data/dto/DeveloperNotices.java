package com.oneorthree.business.upstream.data.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** 개발자 전역 소식은 평문이며 공개 기간 판정은 Data가 한다. */
public final class DeveloperNotices {
    private DeveloperNotices() { }


    public record Notice(UUID publicationId, String title, String body, Instant startsAt, Instant endsAt,
                         Instant publishedAt) { }

    public record Page(List<Notice> items) { }
}
