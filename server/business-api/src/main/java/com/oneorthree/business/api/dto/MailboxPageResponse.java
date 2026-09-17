package com.oneorthree.business.api.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;

/**
 * 우체통 한 묶음 — 화면 순서(오름차순)와 다음 «과거» 묶음의 서명 커서.
 *
 * @param items      한 묶음 안에서 오래된 것부터. 다음 묶음은 이보다 더 과거다(M06)
 * @param nextCursor 서명된 opaque 커서. 더 없으면 null — 키는 항상 실린다
 */
public record MailboxPageResponse(List<MailboxMessageResponse> items,
        @JsonInclude(JsonInclude.Include.ALWAYS) String nextCursor) {
}
