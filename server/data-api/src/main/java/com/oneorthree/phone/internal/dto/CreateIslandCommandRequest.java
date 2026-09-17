package com.oneorthree.phone.internal.dto;

import com.oneorthree.phone.group.dto.CreateGroupRequest;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * {@code POST /internal/users/{userId}/islands} 요청 본문 (GROMO-1759, LLD §3.1).
 *
 * <p>길이 50/200 은 기존 {@code CreateGroupRequest} 의 검증값을 그대로 쓴다. 본문에 {@code maxMembers}
 * 나 {@code password} 를 받지 않는 것이 계약이다 — LLD §1 이 "새 DTO 에 없는 password/maxMembers 를
 * client 가 주입하지 못함"을 명시했다. 정원은 기존 기본값 10 으로 서버가 정한다.
 *
 * <p>모양(키·타입·길이) 거절은 Business 가 네트워크 전에 먼저 한다(400). <b>이름 안전 문자 규칙만은
 * 여기가 유일한 경계</b> 다 — 정의가 {@link CreateGroupRequest#NAME_PATTERN} 하나뿐이고 Business 는
 * 그 클래스를 볼 수 없는 별도 프로젝트라, 복사해 두면 두 정의가 갈린다. 거절은 400
 * {@code INVALID_REQUEST} 이고 Business 가 같은 코드로 옮긴다.
 */
public record CreateIslandCommandRequest(
        @NotBlank @Size(max = 50) @Pattern(regexp = CreateGroupRequest.NAME_PATTERN) String name,
        @Size(max = 200) String intro,
        @NotNull Boolean approvalRequired) {
}
