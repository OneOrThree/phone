package com.oneorthree.phone.user.dto;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/** 차단할 상대만 받는다. 차단 주체는 내부 경로의 userId 로 고정된다. */
public record UserBlockCreateRequest(@NotNull UUID blockedUserId) {
}
