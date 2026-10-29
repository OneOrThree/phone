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

    @Schema(name = "DeveloperNoticePage")
    public record Page(List<Notice> items) {
        public static Page from(DeveloperNotices.Page value) {
            return new Page(value.items().stream().map(Notice::from).toList());
        }
    }

    @Schema(name = "DeveloperNoticeView")
    public record Notice(UUID publicationId, String title, String body, Instant startsAt,
                         @JsonInclude(JsonInclude.Include.ALWAYS) Instant endsAt, Instant publishedAt) {
        public static Notice from(DeveloperNotices.Notice value) {
            return new Notice(value.publicationId(), value.title(), value.body(), value.startsAt(),
                    value.endsAt(), value.publishedAt());
        }
    }
}
