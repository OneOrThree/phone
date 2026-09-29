package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.List;

/**
 * 집중 주민 스냅샷 (GROMO-1765, focus-rest-session LLD §2 focus-group). 공개 GET 의 {@code data} 와 같은
 * 필드를 내부에서 읽으며, 공개 응답은 유스케이스가 별도 DTO로 조립한다.
 *
 * <p>원본의 {@code catColor}·{@code appearance} 와 BFF B14 의 {@code appearanceVersion} 은 아직 없다 — 소유
 * 도메인(계정 Q03 · 외양 GROMO-1783)이 없고 {@code null} 은 「탈퇴·비노출」 뜻이라 대체할 수 없다. 제공자가
 * 생기면 필드를 «추가»한다(우체통 {@code MailboxMessageResponse} 와 같은 결정).
 */
public record IslandFocusMembers(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<Item> items,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String serverNow,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<MemberWatermark> watermarks) {

    /** {@code name} 만 null 허용(탈퇴·미설정) — 키는 항상 실린다. {@code status} 는 active/paused. */
    public record Item(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String userId,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) String name,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String sessionId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String subject,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long activeSeconds,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String status) {
    }
}
