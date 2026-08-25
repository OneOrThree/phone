package com.oneorthree.phone.group.api;

import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.group.api.docs.GroupControllerDocs;
import com.oneorthree.phone.group.service.GroupAnnouncementService;
import com.oneorthree.phone.group.service.GroupMemberService;
import com.oneorthree.phone.group.service.GroupService;
import com.oneorthree.phone.group.dto.CreateAnnouncementRequest;
import com.oneorthree.phone.group.dto.CreateGroupRequest;
import com.oneorthree.phone.group.dto.CreateGroupResponse;
import com.oneorthree.phone.group.dto.GroupAnnouncementResponse;
import com.oneorthree.phone.group.dto.GroupDetailResponse;
import com.oneorthree.phone.group.dto.GroupOverviewResponse;
import com.oneorthree.phone.group.dto.GroupSearchResponse;
import com.oneorthree.phone.group.dto.GroupSummaryResponse;
import com.oneorthree.phone.group.dto.JoinGroupRequest;
import com.oneorthree.phone.group.dto.RenewGroupCodeResponse;
import com.oneorthree.phone.group.dto.GroupSettingsResponse;
import com.oneorthree.phone.group.dto.UpdateGroupRequest;
import com.oneorthree.phone.group.dto.UpdateGroupSettingsRequest;
import lombok.RequiredArgsConstructor;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * 그룹 자체(생성·참가·설정·공지·멤버) API. 챌린지 축은 {@link GroupChallengeController},
 * 내기 축은 {@link GroupBetController} 로 분리됐다(GROMO-1284, policy §9.2 B12) — URL 은 불변.
 *
 * <p>Swagger 애노테이션은 {@link GroupControllerDocs} 로 분리했다(GROMO-1621).
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class GroupController implements GroupControllerDocs {
    private final GroupService groupService;
    private final GroupAnnouncementService groupAnnouncementService;
    private final GroupMemberService groupMemberService;

    @Override
    @PostMapping("/groups")
    public ResponseEntity<CreateGroupResponse> createGroup(
            @Valid @RequestBody CreateGroupRequest request,
            @LoginUser UUID userId) {
        return ResponseEntity.status(HttpStatus.CREATED).body(groupService.createGroup(userId, request));
    }

    @Override
    @GetMapping("/groups")
    public ResponseEntity<List<GroupSummaryResponse>> getMyGroups(@LoginUser UUID userId) {
        return ResponseEntity.ok(groupService.getMyGroups(userId));
    }

    @Override
    @PostMapping("/groups/{groupId}/join")
    public ResponseEntity<Void> joinGroup(
            @PathVariable UUID groupId,
            @RequestBody JoinGroupRequest request,
            @LoginUser UUID userId) {
        groupService.joinGroup(groupId, userId, request);
        return ResponseEntity.noContent().build();
    }

    @Override
    @GetMapping("/groups/{groupId}/overview")
    public ResponseEntity<GroupOverviewResponse> getGroupOverview(
            @PathVariable UUID groupId,
            @LoginUser UUID userId) {
        return ResponseEntity.ok(groupService.getGroupOverview(groupId, userId));
    }

    @Override
    @GetMapping("/groups/search")
    public ResponseEntity<List<GroupSearchResponse>> searchGroups(@RequestParam String query) {
        return ResponseEntity.ok(groupService.searchGroups(query));
    }

    /**
     * @deprecated 미사용 — 초대 링크(groupId) 방식 전환으로 폐기(2026-07-31). 앱이 더 이상 호출하지 않는다.
     *     계약 파괴를 피하려고 엔드포인트만 남겨둔다. 실제 제거는 후속 정리 티켓.
     */
    @Deprecated
    @Override
    @PostMapping("/groups/{groupId}/code")
    public ResponseEntity<RenewGroupCodeResponse> renewGroupCode(
            @PathVariable UUID groupId,
            @LoginUser UUID userId
    ) {
        return ResponseEntity.ok(groupService.renewGroupCode(groupId, userId));
    }

    @Override
    @GetMapping("/groups/{groupId}")
    public ResponseEntity<GroupDetailResponse> getGroupDetail(
            @PathVariable UUID groupId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @LoginUser UUID userId
    ) {
        return ResponseEntity.ok(groupService.getGroupDetail(groupId, userId, date));
    }

    @Override
    @PostMapping("/groups/{groupId}/announcements")
    public ResponseEntity<Void> createGroupAnnouncement(
            @PathVariable UUID groupId,
            @Valid @RequestBody CreateAnnouncementRequest request,
            @LoginUser UUID userId
    ) {
        groupAnnouncementService.createAnnouncement(groupId, userId, request);
        return ResponseEntity.noContent().build();
    }

    @Override
    @GetMapping("/groups/{groupId}/announcements")
    public ResponseEntity<List<GroupAnnouncementResponse>> getGroupAnnouncements(
            @PathVariable UUID groupId,
            @LoginUser UUID userId
    ) {
        return ResponseEntity.ok(groupAnnouncementService.getAnnouncements(groupId, userId));
    }

    @Override
    @PatchMapping("/groups/{groupId}")
    public ResponseEntity<Void> updateGroup(
            @PathVariable UUID groupId,
            @Valid @RequestBody UpdateGroupRequest request,
            @LoginUser UUID userId
    ) {
        groupService.updateGroup(groupId, userId, request);
        return ResponseEntity.noContent().build();
    }

    @Override
    @PatchMapping("/groups/{groupId}/members/{targetUserId}/owner")
    public ResponseEntity<Void> transferOwner(
            @PathVariable UUID groupId,
            @PathVariable UUID targetUserId,
            @LoginUser UUID userId
    ) {
        groupMemberService.transferOwner(groupId, targetUserId, userId);
        return ResponseEntity.noContent().build();
    }

    @Override
    @DeleteMapping("/groups/{groupId}/members/{targetUserId}")
    public ResponseEntity<Void> kickMember(
            @PathVariable UUID groupId,
            @PathVariable UUID targetUserId,
            @LoginUser UUID userId
    ) {
        groupMemberService.kickMember(groupId, targetUserId, userId);
        return ResponseEntity.noContent().build();
    }

    @Override
    @GetMapping("/groups/{groupId}/settings")
    public ResponseEntity<GroupSettingsResponse> getGroupSettings(
            @PathVariable UUID groupId,
            @LoginUser UUID userId
    ) {
        return ResponseEntity.ok(groupService.getGroupSettings(groupId, userId));
    }

    @Override
    @PatchMapping("/groups/{groupId}/settings")
    public ResponseEntity<Void> updateGroupSettings(
            @PathVariable UUID groupId,
            @RequestBody UpdateGroupSettingsRequest request,
            @LoginUser UUID userId
    ) {
        groupService.updateGroupSettings(groupId, userId, request);
        return ResponseEntity.noContent().build();
    }

    @Override
    @PutMapping("/groups/{groupId}/announcements/{announcementId}")
    public ResponseEntity<Void> updateGroupAnnouncement(
            @PathVariable UUID groupId,
            @PathVariable UUID announcementId,
            @Valid @RequestBody CreateAnnouncementRequest request,
            @LoginUser UUID userId
    ) {
        groupAnnouncementService.updateAnnouncement(groupId, announcementId, userId, request);
        return ResponseEntity.noContent().build();
    }

    @Override
    @DeleteMapping("/groups/{groupId}/announcements/{announcementId}")
    public ResponseEntity<Void> deleteGroupAnnouncement(
            @PathVariable UUID groupId,
            @PathVariable UUID announcementId,
            @LoginUser UUID userId
    ) {
        groupAnnouncementService.deleteAnnouncement(groupId, announcementId, userId);
        return ResponseEntity.noContent().build();
    }

    @Override
    @DeleteMapping("/groups/{groupId}/members/me")
    public ResponseEntity<Void> withdrawGroup(
            @PathVariable UUID groupId,
            @LoginUser UUID userId
    ) {
        groupMemberService.withdrawGroup(groupId, userId);
        return ResponseEntity.noContent().build();
    }
}
