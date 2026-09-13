package com.oneorthree.phone.internal.dto;

import com.oneorthree.phone.user.dto.NotificationSettingsResponse;

/** 같은 사용자 잠금 아래 읽은 mirror와 현재 aggregate 세대. Notification 초기화에만 사용한다. */
public record NotificationSettingsSnapshotResponse(long version, long authGeneration,
                                                    NotificationSettingsResponse settings) {
}
