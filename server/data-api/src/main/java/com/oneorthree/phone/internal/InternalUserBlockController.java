package com.oneorthree.phone.internal;

import com.oneorthree.phone.user.dto.BlockedUserResponse;
import com.oneorthree.phone.user.dto.UserBlockCreateRequest;
import com.oneorthree.phone.user.service.UserBlockService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/** 공개 /blocks 위임만 받는 사용자 차단 내부 표면. */
@RestController
@RequestMapping("/internal/users/{userId}/blocks")
@RequiredArgsConstructor
public class InternalUserBlockController {

    private final UserBlockService userBlockService;

    @PostMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void block(@PathVariable UUID userId, @Valid @RequestBody UserBlockCreateRequest request) {
        userBlockService.block(userId, request.blockedUserId());
    }

    @DeleteMapping("/{blockedUserId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unblock(@PathVariable UUID userId, @PathVariable UUID blockedUserId) {
        userBlockService.unblock(userId, blockedUserId);
    }

    @GetMapping
    public List<BlockedUserResponse> blocks(@PathVariable UUID userId) {
        return userBlockService.list(userId);
    }
}
