package com.oneorthree.phone.user.repository;

import java.util.UUID;

/** 유저 현재 티어 배치 조회용 projection. */
public record UserTierLevelProjection(UUID id, int tierLevel) {
}
