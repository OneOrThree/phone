package com.oneorthree.phone.group.api;

import com.oneorthree.phone.common.auth.LoginUser;
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
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
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
 */
@Tag(name = "Group", description = "Group 세션 관련 API (생성, 조회 등)")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class GroupController {
    private final GroupService groupService;
    private final GroupAnnouncementService groupAnnouncementService;
    private final GroupMemberService groupMemberService;

    @Operation(summary = "그룹 생성", description = "그룹 생성 및 참가 코드(3시간 유효) 발급. 생성자는 OWNER로 자동 등록.")
    @ApiResponses({
            @ApiResponse(responseCode = "201", description = "그룹 생성 성공"),
            @ApiResponse(responseCode = "400", description = "미션 파라미터 누락"),
            @ApiResponse(responseCode = "403", description = "게스트 계정 생성 불가")
    })
    @PostMapping("/groups")
    public ResponseEntity<CreateGroupResponse> createGroup(
            @Valid @RequestBody CreateGroupRequest request,
            @LoginUser UUID userId) {
        return ResponseEntity.status(HttpStatus.CREATED).body(groupService.createGroup(userId, request));
    }

    @Operation(summary = "내 그룹 목록 조회", description = "로그인 유저가 참여 중인 그룹 목록 반환.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "조회 성공")
    })
    @GetMapping("/groups")
    public ResponseEntity<List<GroupSummaryResponse>> getMyGroups(@LoginUser UUID userId) {
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
            @PathVariable UUID groupId,
            @RequestBody JoinGroupRequest request,
            @LoginUser UUID userId) {
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
            @PathVariable UUID groupId,
            @LoginUser UUID userId) {
        return ResponseEntity.ok(groupService.getGroupOverview(groupId, userId));
    }

    @Operation(summary = "그룹 검색", description = "공개 그룹 이름 유사도(pg_trgm) 검색, 최대 20건."
            + " 비공개(isPrivate=true)·삭제 그룹은 제외한다. 빈/공백 질의는 빈 배열.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "검색 성공")
    })
    @GetMapping("/groups/search")
    public ResponseEntity<List<GroupSearchResponse>> searchGroups(@RequestParam String query) {
        return ResponseEntity.ok(groupService.searchGroups(query));
    }

    /**
     * @deprecated 미사용 — 초대 링크(groupId) 방식 전환으로 폐기(2026-07-31). 앱이 더 이상 호출하지 않는다.
     *     계약 파괴를 피하려고 엔드포인트만 남겨둔다. 실제 제거는 후속 정리 티켓.
     */
    @Deprecated
    @Operation(summary = "초대 코드 갱신", deprecated = true,
            description = "미사용(2026-07-31 폐기) — 참여는 초대 링크(groupId)가 담당한다."
                    + " 그룹장만 호출 가능. 새 8자 코드 발급 + 유효기간 3시간 갱신.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "갱신 성공"),
            @ApiResponse(responseCode = "403", description = "게스트 / 그룹장 아님"),
            @ApiResponse(responseCode = "404", description = "그룹 없음")
    })
    @PostMapping("/groups/{groupId}/code")
    public ResponseEntity<RenewGroupCodeResponse> renewGroupCode(
            @PathVariable UUID groupId,
            @LoginUser UUID userId
    ) {
        return ResponseEntity.ok(groupService.renewGroupCode(groupId, userId));
    }

    @Operation(summary = "그룹 상세 조회", description = "그룹원만 조회 가능. OWNER에게만 code, codeExpiresAt 반환."
            + " date 는 클라 로컬 타임존 기준 오늘(YYYY-MM-DD) — 멤버별 오늘 집중분 집계 기준.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "조회 성공"),
            @ApiResponse(responseCode = "400", description = "date 누락·형식 오류"),
            @ApiResponse(responseCode = "403", description = "게스트 / 그룹원 아님"),
            @ApiResponse(responseCode = "404", description = "그룹 없음")
    })
    @GetMapping("/groups/{groupId}")
    public ResponseEntity<GroupDetailResponse> getGroupDetail(
            @PathVariable UUID groupId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @LoginUser UUID userId
    ) {
        return ResponseEntity.ok(groupService.getGroupDetail(groupId, userId, date));
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
            @PathVariable UUID groupId,
            @Valid @RequestBody CreateAnnouncementRequest request,
            @LoginUser UUID userId
    ) {
        groupAnnouncementService.createAnnouncement(groupId, userId, request);
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
            @PathVariable UUID groupId,
            @LoginUser UUID userId
    ) {
        return ResponseEntity.ok(groupAnnouncementService.getAnnouncements(groupId, userId));
    }

    @Operation(summary = "그룹 설정 수정",
            description = "OWNER만 가능. name/description/maxMembers/password 부분 수정.")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "수정 성공"),
            @ApiResponse(responseCode = "400",
                    description = "이름·소개·정원 입력 제약 위반 / maxMembers < 현재 멤버 수"),
            @ApiResponse(responseCode = "403", description = "OWNER 아님 / 게스트"),
            @ApiResponse(responseCode = "404", description = "그룹 없음")
    })
    @PatchMapping("/groups/{groupId}")
    public ResponseEntity<Void> updateGroup(
            @PathVariable UUID groupId,
            @Valid @RequestBody UpdateGroupRequest request,
            @LoginUser UUID userId
    ) {
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
            @PathVariable UUID groupId,
            @PathVariable UUID targetUserId,
            @LoginUser UUID userId
    ) {
        groupMemberService.transferOwner(groupId, targetUserId, userId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "멤버 강퇴", description = "현재 OWNER만 호출 가능. 대상 멤버를 강퇴(재참여 차단). 본인은 강퇴 불가.")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "강퇴 성공"),
            @ApiResponse(responseCode = "400", description = "본인 강퇴 시도"),
            @ApiResponse(responseCode = "403", description = "OWNER 아님 / 게스트"),
            @ApiResponse(responseCode = "404", description = "그룹 없음 / 대상 멤버 없음")
    })
    @DeleteMapping("/groups/{groupId}/members/{targetUserId}")
    public ResponseEntity<Void> kickMember(
            @PathVariable UUID groupId,
            @PathVariable UUID targetUserId,
            @LoginUser UUID userId
    ) {
        groupMemberService.kickMember(groupId, targetUserId, userId);
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
            @PathVariable UUID groupId,
            @LoginUser UUID userId
    ) {
        return ResponseEntity.ok(groupService.getGroupSettings(groupId, userId));
    }

    @Operation(summary = "그룹 채팅·권한 설정 수정", description = "OWNER만 가능. null 필드는 미변경(PATCH). 성공 시 204 반환.")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "수정 성공"),
            @ApiResponse(responseCode = "403", description = "OWNER 아님 / 게스트 / 그룹원 아님"),
            @ApiResponse(responseCode = "404", description = "그룹 없음")
    })
    @PatchMapping("/groups/{groupId}/settings")
    public ResponseEntity<Void> updateGroupSettings(
            @PathVariable UUID groupId,
            @RequestBody UpdateGroupSettingsRequest request,
            @LoginUser UUID userId
    ) {
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
    public ResponseEntity<Void> updateGroupAnnouncement(
            @PathVariable UUID groupId,
            @PathVariable UUID announcementId,
            @Valid @RequestBody CreateAnnouncementRequest request,
            @LoginUser UUID userId
    ) {
        groupAnnouncementService.updateAnnouncement(groupId, announcementId, userId, request);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "그룹 공지 삭제", description = "OWNER 또는 공지 권한 부여된 멤버만 삭제 가능. 성공 시 204 반환.")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "삭제 성공"),
            @ApiResponse(responseCode = "403", description = "권한 없음 / 게스트"),
            @ApiResponse(responseCode = "404", description = "그룹 없음 / 공지 없음")
    })
    @DeleteMapping("/groups/{groupId}/announcements/{announcementId}")
    public ResponseEntity<Void> deleteGroupAnnouncement(
            @PathVariable UUID groupId,
            @PathVariable UUID announcementId,
            @LoginUser UUID userId
    ) {
        groupAnnouncementService.deleteAnnouncement(groupId, announcementId, userId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "그룹 탈퇴", description = "MEMBER는 즉시 탈퇴. OWNER는 위임 후 탈퇴 가능. 마지막 1인 탈퇴 시 그룹 ENDED. 성공 시 204 반환.")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "탈퇴 성공"),
            @ApiResponse(responseCode = "400", description = "방장 위임 필요"),
            @ApiResponse(responseCode = "403", description = "게스트 / 그룹원 아님"),
            @ApiResponse(responseCode = "404", description = "그룹 없음")
    })
    @DeleteMapping("/groups/{groupId}/members/me")
    public ResponseEntity<Void> withdrawGroup(
            @PathVariable UUID groupId,
            @LoginUser UUID userId
    ) {
        groupMemberService.withdrawGroup(groupId, userId);
        return ResponseEntity.noContent().build();
    }
}
