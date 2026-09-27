package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/** 현재 작업자만 상태를 완료하거나 lease를 반납할 수 있게 하는 fencing token. */
public record ReportDeliveryLeaseRequest(@NotNull UUID leaseToken) {
}
