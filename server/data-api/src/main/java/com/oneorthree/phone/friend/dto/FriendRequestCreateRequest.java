package com.oneorthree.phone.friend.dto;

import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.UUID;

/**
 * 친구 요청 생성 본문. 보내는 쪽은 인증 토큰에서 나오므로 받는 쪽만 담는다.
 */
@Getter
@NoArgsConstructor
@AllArgsConstructor
public class FriendRequestCreateRequest {

    @NotNull
    private UUID targetUserId;
}
