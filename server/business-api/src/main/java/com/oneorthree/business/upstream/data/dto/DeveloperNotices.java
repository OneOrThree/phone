package com.oneorthree.business.upstream.data.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** 개발자 전역 소식은 평문이며 공개 기간 판정은 Data가 한다. */
public final class DeveloperNotices {
    private DeveloperNotices() { }


    // min 은 옛 Data 응답에는 없다 — null 이면 패치노트로 본다.
    public record Notice(UUID publicationId, String title, String body, Instant startsAt, Instant endsAt,
                         Instant publishedAt, String minIosVersion, String minAndroidVersion) { }

    /** 플랫폼의 현재 최소 버전 공지. 해당 공지가 없으면 전부 null. */
    public record AppRequirement(String minVersion, String title, String body, UUID publicationId,
                                 Instant publishedAt) { }

    public record Page(List<Notice> items) { }
}
