package com.oneorthree.business.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * claim 요청 — 기존 Data API {@code ClaimInviteRequest} 와 <b>제약까지 같다</b>.
 *
 * <p>{@code @Size(max = 12)} 를 유지하는 이유: 기존 컬럼 길이에 맞춰 입력에서 막던 값이고, 느슨하게
 * 바꾸면 여기선 통과한 요청이 상류에서 터진다. 조건을 «좁히지도» 않는다 — 지금 통과하던 요청이
 * Business 를 앞에 세운 것만으로 400 이 되면 그게 회귀다.
 */
public record ClaimInviteRequest(@NotBlank @Size(max = 12) String slug) {
}
