package com.oneorthree.phone.invitelink.api;

import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.invitelink.dto.ClaimInviteRequest;
import com.oneorthree.phone.invitelink.dto.IssueInviteLinkResponse;
import com.oneorthree.phone.invitelink.service.InviteLinkMatchService;
import com.oneorthree.phone.invitelink.service.InviteLinkService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/** 인증이 필요한 초대 링크 API (발급·claim). 무인증 경로({@code /l/*})는 {@link LinkPublicController} 가 맡는다. */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
@Tag(name = "InviteLink", description = "그룹 초대 링크")
public class InviteLinkController {

    private final InviteLinkService inviteLinkService;
    private final InviteLinkMatchService inviteLinkMatchService;

    @Operation(summary = "초대 링크 발급", description = "(그룹, 로그인 유저)당 1개를 재사용하는 멱등 발급")
    @PostMapping("/groups/{groupId}/invite-link")
    public ResponseEntity<IssueInviteLinkResponse> issueInviteLink(
            @PathVariable UUID groupId,
            @LoginUser UUID userId) {
        return ResponseEntity.ok(inviteLinkService.issue(groupId, userId));
    }

    @Operation(summary = "초대 claim", description = "가입/로그인 직후 1회. 이미 claim 됐거나 셀프 초대면 no-op 200")
    @PostMapping("/invite-links/claim")
    public ResponseEntity<Void> claim(
            @Valid @RequestBody ClaimInviteRequest request,
            @LoginUser UUID userId) {
        inviteLinkMatchService.claim(request.slug(), userId);
        return ResponseEntity.ok().build();
    }
}
