package com.oneorthree.phone.invitelink;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;

/**
 * {@code WellKnownController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 */
@Tag(name = "WellKnown", description = "Universal Links 연결 파일")
public interface WellKnownControllerDocs {

    /** @return AASA 본문 */
    @Operation(summary = "AASA 서빙", description = "application/json, 리다이렉트 없음")
    ResponseEntity<String> appleAppSiteAssociation();
}
