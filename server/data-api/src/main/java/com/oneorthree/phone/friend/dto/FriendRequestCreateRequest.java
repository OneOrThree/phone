package com.oneorthree.phone.friend.dto;

import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.UUID;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class FriendRequestCreateRequest {

    @NotNull
    private UUID targetUserId;
}
