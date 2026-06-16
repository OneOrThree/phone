package com.oneorthree.phone.api;

import com.oneorthree.phone.service.GroupService;
import com.oneorthree.phone.service.dto.group.CreateGroupRequest;
import com.oneorthree.phone.service.dto.group.CreateGroupResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "Group", description = "Group 세션 관련 API (생성, 조회 등)")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class GroupController {
    private final GroupService groupService;

    @Operation(summary = "그룹 생성", description = "그룹 생성 및 참가 코드(24시간 유효) 발급. 생성자는 OWNER로 자동 등록.")
    @ApiResponses({
            @ApiResponse(responseCode = "201", description = "그룹 생성 성공"),
            @ApiResponse(responseCode = "400", description = "미션 파라미터 누락"),
            @ApiResponse(responseCode = "403", description = "게스트 계정 생성 불가")
    })
    @PostMapping("/groups")
    @ResponseStatus(HttpStatus.CREATED)
    public CreateGroupResponse createGroup(
            @Valid @RequestBody CreateGroupRequest request,
            HttpServletRequest httpServletRequest) {
        Long userId = (Long) httpServletRequest.getAttribute("userId");
        return groupService.createGroup(userId, request);
    }
}
