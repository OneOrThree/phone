package com.oneorthree.phone.user.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * 스크린타임 권한 보유 여부 갱신 요청 — OS 권한 상태를 앱이 <b>보고</b>하는 것이지 서버가 검증하지는 않는다.
 *
 * <p>이 플래그가 스크린타임 유료 회차 참여 가드에 걸려 있다. 권한이 없으면 보고 자체가 안 돼
 * 미달성=확정 패배가 되므로, 서버는 회수와 참여를 잠금으로 직렬화한다.
 */
@Getter
@NoArgsConstructor
public class UpdateScreenTimePermissionRequest {
    @NotNull
    private Boolean granted;
}
