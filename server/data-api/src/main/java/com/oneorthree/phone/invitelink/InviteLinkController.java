package com.oneorthree.phone.invitelink;

import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.invitelink.dto.ClaimInviteRequest;
import com.oneorthree.phone.invitelink.dto.IssueInviteLinkResponse;
import com.oneorthree.phone.invitelink.service.InviteLinkMatchService;
import com.oneorthree.phone.invitelink.service.InviteLinkService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 인증이 필요한 초대 링크 API (발급·claim). 무인증 경로({@code /l/*})는 {@link LinkPublicController} 가 맡는다.
 * Swagger 애노테이션은 {@link InviteLinkControllerDocs} 로 분리했다(GROMO-1621).
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class InviteLinkController implements InviteLinkControllerDocs {

    private final InviteLinkService inviteLinkService;
    private final InviteLinkMatchService inviteLinkMatchService;

    @Override
    @PostMapping("/groups/{groupId}/invite-link")
    public ResponseEntity<IssueInviteLinkResponse> issueInviteLink(
            @PathVariable UUID groupId,
            @LoginUser UUID userId) {
        return ResponseEntity.ok(inviteLinkService.issue(groupId, userId));
    }

    @Override
    @PostMapping("/invite-links/claim")
    public ResponseEntity<Void> claim(
            @Valid @RequestBody ClaimInviteRequest request,
            @LoginUser UUID userId) {
        inviteLinkMatchService.claim(request.slug(), userId);
        return ResponseEntity.ok().build();
    }
}
