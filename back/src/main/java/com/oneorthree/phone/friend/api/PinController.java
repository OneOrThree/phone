package com.oneorthree.phone.friend.api;

import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.friend.dto.PinnedUserResponse;
import com.oneorthree.phone.friend.service.FriendService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

// 핀 API — 리그·친구 공용. 친구 아닌 임의 유저도 핀 가능(user 핀 통일, GROMO-609).
@Tag(name = "Pin", description = "유저 핀 API (리그·친구 공용) — 친구 아닌 임의 유저도 핀 가능")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class PinController {

    private final FriendService friendService;

    @Operation(summary = "유저 핀 설정",
            description = "임의 유저(친구 아니어도 가능)를 핀해 홈·집중·리그 화면에 표시. 이미 핀이면 멱등(204). "
                    + "자기 자신은 400.")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "핀 설정 성공"),
            @ApiResponse(responseCode = "400", description = "자기 자신 핀 시도"),
            @ApiResponse(responseCode = "404", description = "대상 유저 없음")
    })
    @PostMapping("/pins/{userId}")
    public ResponseEntity<Void> pin(
            @PathVariable UUID userId,
            @LoginUser UUID me) {
        friendService.pinFriend(me, userId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "유저 핀 해제", description = "핀 해제. 핀이 없어도 멱등(204).")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "핀 해제 성공"),
            @ApiResponse(responseCode = "404", description = "대상 유저 없음")
    })
    @DeleteMapping("/pins/{userId}")
    public ResponseEntity<Void> unpin(
            @PathVariable UUID userId,
            @LoginUser UUID me) {
        friendService.unpinFriend(me, userId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "핀한 유저 조회",
            description = "내가 핀한 유저 목록(친구 아님 포함). 캐릭터 표시정보 + 오늘 집중분 + 현재 집중 여부 포함."
                    + " date 는 클라 로컬 타임존 기준 오늘(YYYY-MM-DD).")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "조회 성공"),
            @ApiResponse(responseCode = "400", description = "date 누락·형식 오류")
    })
    @GetMapping("/pins")
    public ResponseEntity<List<PinnedUserResponse>> getPins(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @LoginUser UUID me) {
        return ResponseEntity.ok(friendService.getPinnedFriends(me, date));
    }
}
