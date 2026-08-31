package com.oneorthree.phone.invitelink;

import com.oneorthree.phone.invitelink.dto.ClaimInviteRequest;
import com.oneorthree.phone.invitelink.dto.IssueInviteLinkResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;

import java.util.UUID;

/**
 * {@code InviteLinkController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 */
@Tag(name = "InviteLink", description = "그룹 초대 링크")
public interface InviteLinkControllerDocs {

    @Operation(summary = "초대 링크 발급", description = "(그룹, 로그인 유저)당 1개를 재사용하는 멱등 발급")
    ResponseEntity<IssueInviteLinkResponse> issueInviteLink(UUID groupId, UUID userId);

    @Operation(summary = "초대 claim", description = "가입/로그인 직후 1회. 이미 claim 됐거나 셀프 초대면 no-op 200")
    ResponseEntity<Void> claim(ClaimInviteRequest request, UUID userId);
}
