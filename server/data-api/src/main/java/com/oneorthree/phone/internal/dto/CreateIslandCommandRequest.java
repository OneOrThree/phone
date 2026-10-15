package com.oneorthree.phone.internal.dto;

import com.oneorthree.phone.group.dto.CreateGroupRequest;
import com.oneorthree.phone.group.repository.domain.Group;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * {@code POST /internal/users/{userId}/islands} 요청 본문 (GROMO-1759, LLD §3.1).
 *
 * <p>길이 50/200 은 기존 {@code CreateGroupRequest} 의 검증값을 그대로 쓴다. {@code password} 는 여전히
 * 받지 않는다 — LLD §1 의 "새 DTO 에 없는 값을 client 가 주입하지 못함" 중 잠금 축은 그대로다.
 *
 * <p><b>{@code maxMembers} 는 GROMO-1993 에서 열었다.</b> 정책(policy-2026-09-14)이 「섬 생성 시 방장이
 * 가입 방식과 정원을 설정한다. 정원은 1~15명이며, 따로 정하지 않으면 15명이다」로 확정했으므로 서버가
 * 정하던 값이 아니라 방장의 입력이다. 생략(null)이면 {@link Group#DEFAULT_MAX_MEMBERS} 다.
 *
 * <p>모양(키·타입·길이) 거절은 Business 가 네트워크 전에 먼저 한다(400). <b>이름 안전 문자 규칙만은
 * 여기가 유일한 경계</b> 다 — 정의가 {@link CreateGroupRequest#NAME_PATTERN} 하나뿐이고 Business 는
 * 그 클래스를 볼 수 없는 별도 프로젝트라, 복사해 두면 두 정의가 갈린다. 거절은 400
 * {@code INVALID_REQUEST} 이고 Business 가 같은 코드로 옮긴다.
 */
public record CreateIslandCommandRequest(
        @NotBlank @Size(max = 50) @Pattern(regexp = CreateGroupRequest.NAME_PATTERN) String name,
        @Size(max = 200) String intro,
        @NotNull Boolean approvalRequired,
        @Min(Group.MAX_MEMBERS_FLOOR) @Max(Group.MAX_MEMBERS_CEILING) Integer maxMembers) {

    /** 방장이 정하지 않았으면 정책 기본값 — 「따로 정하지 않으면 15명」. */
    public int maxMembersOrDefault() {
        return maxMembers == null ? Group.DEFAULT_MAX_MEMBERS : maxMembers;
    }
}
