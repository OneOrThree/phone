package com.oneorthree.phone.api;

import com.oneorthree.phone.service.GroupService;
import com.oneorthree.phone.service.dto.group.CreateGroupRequest;
import com.oneorthree.phone.service.dto.group.CreateGroupResponse;
import com.oneorthree.phone.service.dto.group.GroupOverviewResponse;
import com.oneorthree.phone.service.dto.group.GroupSearchResponse;
import com.oneorthree.phone.service.dto.group.GroupSummaryResponse;
import com.oneorthree.phone.service.dto.group.JoinGroupRequest;
import com.oneorthree.phone.service.dto.group.RenewGroupCodeResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
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

    // TODO GROMO-285: GET /groups/{groupId} → 200 GroupDetailResponse
    //   groupService.getGroupDetail(groupId, userId) 호출

    // TODO GROMO-287: GET /groups/{groupId}/announcements → 200 List<GroupAnnouncementResponse>
    //   groupService.getAnnouncements(groupId, userId) 호출

    // TODO GROMO-289: GET /groups/{groupId}/challenges → 200 List<GroupChallengeResponse>
    //   groupService.getChallenges(groupId, userId) 호출
}
