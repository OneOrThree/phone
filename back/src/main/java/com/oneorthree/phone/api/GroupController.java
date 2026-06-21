package com.oneorthree.phone.api;

import com.oneorthree.phone.service.GroupService;
import com.oneorthree.phone.service.dto.group.CreateAnnouncementRequest;
import com.oneorthree.phone.service.dto.group.CreateChallengeRequest;
import com.oneorthree.phone.service.dto.group.CreateChallengeResponse;
import com.oneorthree.phone.service.dto.group.CreateGroupRequest;
import com.oneorthree.phone.service.dto.group.CreateGroupResponse;
import com.oneorthree.phone.service.dto.group.GroupAnnouncementResponse;
import com.oneorthree.phone.service.dto.group.GroupChallengeResponse;
import com.oneorthree.phone.service.dto.group.GroupDetailResponse;
import com.oneorthree.phone.service.dto.group.GroupOverviewResponse;
import com.oneorthree.phone.service.dto.group.GroupSearchResponse;
import com.oneorthree.phone.service.dto.group.GroupSummaryResponse;
import com.oneorthree.phone.service.dto.group.JoinGroupRequest;
import com.oneorthree.phone.service.dto.group.RenewGroupCodeResponse;
import com.oneorthree.phone.service.dto.group.GroupSettingsResponse;
import com.oneorthree.phone.service.dto.group.UpdateGroupRequest;
import com.oneorthree.phone.service.dto.group.UpdateGroupSettingsRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
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

import java.util.List;

@Tag(name = "Group", description = "Group 세션 관련 API (생성, 조회 등)")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class GroupController {
    private final GroupService groupService;

    @Operation(summary = "그룹 생성", description = "그룹 생성 및 참가 코드(3시간 유효) 발급. 생성자는 OWNER로 자동 등록.")
    @ApiResponses({
            @ApiResponse(responseCode = "201", description = "그룹 생성 성공"),
            @ApiResponse(responseCode = "400", description = "미션 파라미터 누락"),
            @ApiResponse(responseCode = "403", description = "게스트 계정 생성 불가")
    })
    @PostMapping("/groups")
    public ResponseEntity<CreateGroupResponse> createGroup(
            @Valid @RequestBody CreateGroupRequest request,
            HttpServletRequest httpServletRequest) {
        Long userId = (Long) httpServletRequest.getAttribute("userId");
        return ResponseEntity.status(HttpStatus.CREATED).body(groupService.createGroup(userId, request));
    }

    @Operation(summary = "내 그룹 목록 조회", description = "로그인 유저가 참여 중인 그룹 목록 반환.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "조회 성공")
    })
    @GetMapping("/groups")
    public ResponseEntity<List<GroupSummaryResponse>> getMyGroups(HttpServletRequest httpServletRequest) {
        Long userId = (Long) httpServletRequest.getAttribute("userId");
        return ResponseEntity.ok(groupService.getMyGroups(userId));
    }

    @Operation(summary = "그룹 참가", description = "비밀번호 그룹은 password 필드 포함. 성공 시 204 반환.")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "참가 성공"),
            @ApiResponse(responseCode = "401", description = "비밀번호 불일치"),
            @ApiResponse(responseCode = "403", description = "게스트 접근 불가"),
            @ApiResponse(responseCode = "404", description = "그룹 없음"),
            @ApiResponse(responseCode = "409", description = "정원 초과 / 이미 참여")
    })
    @PostMapping("/groups/{groupId}/join")
    public ResponseEntity<Void> joinGroup(
            @PathVariable Long groupId,
            @RequestBody JoinGroupRequest request,
            HttpServletRequest httpServletRequest) {
        Long userId = (Long) httpServletRequest.getAttribute("userId");
        groupService.joinGroup(groupId, userId, request);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "그룹 개요 조회", description = "참여 여부 무관하게 그룹 공개 정보 반환. isMember 플래그 포함.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "조회 성공"),
            @ApiResponse(responseCode = "404", description = "그룹 없음")
    })
    @GetMapping("/groups/{groupId}/overview")
    public ResponseEntity<GroupOverviewResponse> getGroupOverview(
            @PathVariable Long groupId,
            HttpServletRequest httpServletRequest) {
        Long userId = (Long) httpServletRequest.getAttribute("userId");
        return ResponseEntity.ok(groupService.getGroupOverview(groupId, userId));
    }

    @Operation(summary = "그룹 검색", description = "8자 영숫자면 코드 정확 매칭, 아니면 이름 LIKE 검색. 만료 코드 그룹 제외.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "검색 성공")
    })
    @GetMapping("/groups/search")
    public ResponseEntity<List<GroupSearchResponse>> searchGroups(@RequestParam String query) {
        return ResponseEntity.ok(groupService.searchGroups(query));
    }

    @Operation(summary = "초대 코드 갱신", description = "그룹장만 호출 가능. 새 8자 코드 발급 + 유효기간 3시간 갱신.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "갱신 성공"),
            @ApiResponse(responseCode = "403", description = "게스트 / 그룹장 아님"),
            @ApiResponse(responseCode = "404", description = "그룹 없음")
    })
    @PostMapping("/groups/{groupId}/code")
    public ResponseEntity<RenewGroupCodeResponse> renewGroupCode(
            @PathVariable Long groupId,
            HttpServletRequest httpServletRequest
    ) {
        Long userId = (Long) httpServletRequest.getAttribute("userId");
        return ResponseEntity.ok(groupService.renewGroupCode(groupId, userId));
    }

    @Operation(summary = "그룹 상세 조회", description = "그룹원만 조회 가능. OWNER에게만 code, codeExpiresAt 반환.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "조회 성공"),
            @ApiResponse(responseCode = "403", description = "게스트 / 그룹원 아님"),
            @ApiResponse(responseCode = "404", description = "그룹 없음")
    })
    @GetMapping("/groups/{groupId}")
    public ResponseEntity<GroupDetailResponse> getGroupDetail(
            @PathVariable Long groupId,
            HttpServletRequest httpServletRequest
    ) {
        Long userId = (Long) httpServletRequest.getAttribute("userId");
        return ResponseEntity.ok(groupService.getGroupDetail(groupId, userId));
    }

    @Operation(summary = "그룹 공지 작성", description = "OWNER만 작성 가능. 성공 시 204 반환.")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "작성 성공"),
            @ApiResponse(responseCode = "400", description = "필수 필드 누락"),
            @ApiResponse(responseCode = "403", description = "OWNER 아님 / 게스트 / 그룹원 아님"),
            @ApiResponse(responseCode = "404", description = "그룹 없음")
    })
    @PostMapping("/groups/{groupId}/announcements")
    public ResponseEntity<Void> createGroupAnnouncement(
            @PathVariable Long groupId,
            @Valid @RequestBody CreateAnnouncementRequest request,
            HttpServletRequest httpServletRequest
    ) {
        Long userId = (Long) httpServletRequest.getAttribute("userId");
        groupService.createAnnouncement(groupId, userId, request);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "그룹 공지 목록 조회", description = "그룹원만 조회 가능. 최신순 반환.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "조회 성공"),
            @ApiResponse(responseCode = "403", description = "게스트 / 그룹원 아님"),
            @ApiResponse(responseCode = "404", description = "그룹 없음")
    })
    @GetMapping("/groups/{groupId}/announcements")
    public ResponseEntity<List<GroupAnnouncementResponse>> getGroupAnnouncements(
            @PathVariable Long groupId,
            HttpServletRequest httpServletRequest
    ) {
        Long userId = (Long) httpServletRequest.getAttribute("userId");
        return ResponseEntity.ok(groupService.getAnnouncements(groupId, userId));
    }

    @Operation(summary = "그룹 설정 수정", description = "OWNER만 가능. name/maxMembers/password 부분 수정.")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "수정 성공"),
            @ApiResponse(responseCode = "400", description = "maxMembers < 현재 멤버 수"),
            @ApiResponse(responseCode = "403", description = "OWNER 아님 / 게스트"),
            @ApiResponse(responseCode = "404", description = "그룹 없음")
    })
    @PatchMapping("/groups/{groupId}")
    public ResponseEntity<Void> updateGroup(
            @PathVariable Long groupId,
            @RequestBody UpdateGroupRequest request,
            HttpServletRequest httpServletRequest
    ) {
        Long userId = (Long) httpServletRequest.getAttribute("userId");
        groupService.updateGroup(groupId, userId, request);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "그룹장 위임", description = "현재 OWNER만 호출 가능. 대상 MEMBER에게 OWNER 위임 후 본인은 MEMBER로 강등.")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "위임 성공"),
            @ApiResponse(responseCode = "403", description = "OWNER 아님 / 게스트"),
            @ApiResponse(responseCode = "404", description = "그룹 없음 / 대상 멤버 없음")
    })
    @PatchMapping("/groups/{groupId}/members/{targetUserId}/owner")
    public ResponseEntity<Void> transferOwner(
            @PathVariable Long groupId,
            @PathVariable Long targetUserId,
            HttpServletRequest httpServletRequest
    ) {
        Long userId = (Long) httpServletRequest.getAttribute("userId");
        groupService.transferOwner(groupId, targetUserId, userId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "그룹 챌린지 목록 조회", description = "그룹원만 조회 가능. 최신순 반환.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "조회 성공"),
            @ApiResponse(responseCode = "403", description = "게스트 / 그룹원 아님"),
            @ApiResponse(responseCode = "404", description = "그룹 없음")
    })
    @GetMapping("/groups/{groupId}/challenges")
    public ResponseEntity<List<GroupChallengeResponse>> getGroupChallenges(
            @PathVariable Long groupId,
            HttpServletRequest httpServletRequest
    ) {
        Long userId = (Long) httpServletRequest.getAttribute("userId");
        return ResponseEntity.ok(groupService.getChallenges(groupId, userId));
    }

    @Operation(summary = "그룹 챌린지 생성", description = "OWNER만 생성 가능. 성공 시 201 반환.")
    @ApiResponses({
            @ApiResponse(responseCode = "201", description = "챌린지 생성 성공"),
            @ApiResponse(responseCode = "400", description = "파라미터 누락 / 유효하지 않은 타임존 / windowStart >= windowEnd"),
            @ApiResponse(responseCode = "403", description = "게스트 / 그룹원 아님 / OWNER 아님"),
            @ApiResponse(responseCode = "404", description = "그룹 없음"),
            @ApiResponse(responseCode = "409", description = "같은 카테고리에 활성 챌린지 이미 존재")
    })
    @PostMapping("/groups/{groupId}/challenges")
    public ResponseEntity<CreateChallengeResponse> createGroupChallenge(
            @PathVariable Long groupId,
            @Valid @RequestBody CreateChallengeRequest request,
            HttpServletRequest httpServletRequest
    ) {
        Long userId = (Long) httpServletRequest.getAttribute("userId");
        return ResponseEntity.status(HttpStatus.CREATED).body(groupService.createChallenge(groupId, userId, request));
    }

    @Operation(summary = "그룹 챌린지 삭제", description = "OWNER만 삭제 가능. 성공 시 204 반환.")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "삭제 성공"),
            @ApiResponse(responseCode = "403", description = "게스트 / 그룹원 아님 / OWNER 아님"),
            @ApiResponse(responseCode = "404", description = "그룹 없음 / 챌린지 없음")
    })
    @DeleteMapping("/groups/{groupId}/challenges/{challengeId}")
    public ResponseEntity<?> deleteGroupChallenge(
            @PathVariable Long groupId,
            @PathVariable Long challengeId,
            HttpServletRequest httpServletRequest
    ) {
        Long userId = (Long) httpServletRequest.getAttribute("userId");
        groupService.deleteChallenge(groupId, challengeId, userId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "그룹 채팅·권한 설정 조회", description = "OWNER만 조회 가능.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "조회 성공"),
            @ApiResponse(responseCode = "403", description = "OWNER 아님 / 게스트 / 그룹원 아님"),
            @ApiResponse(responseCode = "404", description = "그룹 없음")
    })
    @GetMapping("/groups/{groupId}/settings")
    public ResponseEntity<GroupSettingsResponse> getGroupSettings(
            @PathVariable Long groupId,
            HttpServletRequest httpServletRequest
    ) {
        Long userId = (Long) httpServletRequest.getAttribute("userId");
        return ResponseEntity.ok(groupService.getGroupSettings(groupId, userId));
    }

    @Operation(summary = "그룹 채팅·권한 설정 수정", description = "OWNER만 가능. null 필드는 미변경(PATCH). 성공 시 204 반환.")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "수정 성공"),
            @ApiResponse(responseCode = "403", description = "OWNER 아님 / 게스트 / 그룹원 아님"),
            @ApiResponse(responseCode = "404", description = "그룹 없음")
    })
    @PatchMapping("/groups/{groupId}/settings")
    public ResponseEntity<?> updateGroupSettings(
            @PathVariable Long groupId,
            @RequestBody UpdateGroupSettingsRequest request,
            HttpServletRequest httpServletRequest
    ) {
        Long userId = (Long) httpServletRequest.getAttribute("userId");
        groupService.updateGroupSettings(groupId, userId, request);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "그룹 공지 수정", description = "OWNER 또는 공지 권한 부여된 멤버만 수정 가능. 성공 시 204 반환.")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "수정 성공"),
            @ApiResponse(responseCode = "403", description = "권한 없음 / 게스트"),
            @ApiResponse(responseCode = "404", description = "그룹 없음 / 공지 없음")
    })
    @PutMapping("/groups/{groupId}/announcements/{announcementId}")
    public ResponseEntity<?> updateGroupAnnouncement(
            @PathVariable Long groupId,
            @PathVariable Long announcementId,
            @Valid @RequestBody CreateAnnouncementRequest request,
            HttpServletRequest httpServletRequest
    ) {
        Long userId = (Long) httpServletRequest.getAttribute("userId");
        groupService.updateAnnouncement(groupId, announcementId, userId, request);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "그룹 공지 삭제", description = "OWNER 또는 공지 권한 부여된 멤버만 삭제 가능. 성공 시 204 반환.")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "삭제 성공"),
            @ApiResponse(responseCode = "403", description = "권한 없음 / 게스트"),
            @ApiResponse(responseCode = "404", description = "그룹 없음 / 공지 없음")
    })
    @DeleteMapping("/groups/{groupId}/announcements/{announcementId}")
    public ResponseEntity<?> deleteGroupAnnouncement(
            @PathVariable Long groupId,
            @PathVariable Long announcementId,
            HttpServletRequest httpServletRequest
    ) {
        Long userId = (Long) httpServletRequest.getAttribute("userId");
        groupService.deleteAnnouncement(groupId, announcementId, userId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "그룹 탈퇴", description = "MEMBER는 즉시 탈퇴. OWNER는 위임 후 탈퇴 가능. 마지막 1인 탈퇴 시 그룹 CLOSED. 성공 시 204 반환.")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "탈퇴 성공"),
            @ApiResponse(responseCode = "400", description = "방장 위임 필요"),
            @ApiResponse(responseCode = "403", description = "게스트 / 그룹원 아님"),
            @ApiResponse(responseCode = "404", description = "그룹 없음")
    })
    @DeleteMapping("/groups/{groupId}/members/me")
    public ResponseEntity<?> withdrawGroup(
            @PathVariable Long groupId,
            HttpServletRequest httpServletRequest
    ) {
        Long userId = (Long) httpServletRequest.getAttribute("userId");
        groupService.withdrawGroup(groupId, userId);
        return ResponseEntity.noContent().build();
    }
}
