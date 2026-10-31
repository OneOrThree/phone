package com.oneorthree.business.api.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.oneorthree.business.upstream.data.dto.DeveloperNotices;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** 개발자 소식의 앱 공개 계약. 상류 DTO와 문서 스키마를 분리한다. */
public final class DeveloperNoticeResponses {
    private DeveloperNoticeResponses() {
    }

    /** 최신순 한 쪽 — {@code nextCursor} 는 더 없으면 null 이고 키는 항상 실린다. */
    @Schema(name = "DeveloperNoticePage")
    public record Page(List<Notice> items, @JsonInclude(JsonInclude.Include.ALWAYS) String nextCursor) {
        public static Page from(DeveloperNotices.Page value, String nextCursor) {
            return new Page(value.items().stream().map(Notice::from).toList(), nextCursor);
        }
    }

    @Schema(name = "DeveloperNoticeView")
    public record Notice(UUID publicationId, String title, String body, Instant startsAt,
                         @JsonInclude(JsonInclude.Include.ALWAYS) Instant endsAt, Instant publishedAt,
                         boolean forcesUpdate) {
        public static Notice from(DeveloperNotices.Notice value) {
            return new Notice(value.publicationId(), value.title(), value.body(), value.startsAt(),
                    value.endsAt(), value.publishedAt(),
                    value.minIosVersion() != null || value.minAndroidVersion() != null);
        }
    }

    /** 로그인 전 앱이 읽는 최소 버전. 공지가 없으면 키는 있고 값만 전부 null. */
    @Schema(name = "AppRequirement")
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record AppRequirement(String minVersion, String title, String body, UUID publicationId,
                                 Instant publishedAt) {
        public static AppRequirement from(DeveloperNotices.AppRequirement value) {
            return new AppRequirement(value.minVersion(), value.title(), value.body(), value.publicationId(),
                    value.publishedAt());
        }
    }
}
