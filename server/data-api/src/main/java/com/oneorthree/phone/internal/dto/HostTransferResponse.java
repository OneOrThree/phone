package com.oneorthree.phone.internal.dto;

import java.util.UUID;

/** 권한을 잃은 원 호출자에게도 제한 재생할 수 있는 최소 완료 증거. 현재 관리자 정보가 아니다. */
public record HostTransferResponse(UUID hostUserId, long version) {
}
