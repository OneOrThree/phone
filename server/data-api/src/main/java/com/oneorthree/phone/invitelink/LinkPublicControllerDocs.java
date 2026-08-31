package com.oneorthree.phone.invitelink;

import com.oneorthree.phone.invitelink.dto.InviteMatchRequest;
import com.oneorthree.phone.invitelink.dto.InviteMatchResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;

/**
 * {@code LinkPublicController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 */
@Tag(name = "InviteLink(public)", description = "무인증 초대 링크 — 랜딩·deferred 매치")
public interface LinkPublicControllerDocs {

    @Operation(summary = "초대 랜딩", description = "만료·미존재 slug 도 200 HTML(만료 변형)")
    ResponseEntity<String> landing(String slug, HttpServletRequest request);

    @Operation(summary = "deferred 매치",
            description = "IP해시+OS+시간창 fingerprint 로 미소진 클릭 1건을 원자적으로 소진")
    ResponseEntity<InviteMatchResponse> match(InviteMatchRequest request, HttpServletRequest httpRequest);
}
