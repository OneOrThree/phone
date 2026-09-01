package com.oneorthree.phone.user.dto;

import com.oneorthree.phone.user.repository.domain.Occupation;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * 직군 변경 요청. 폐기된 직군은 저장 시점에 거절되므로(400), 선택지는 직군 마스터에서 받아온
 * 활성 목록이어야 한다.
 *
 * <p>직군을 바꿔도 <b>이미 채택한 집중 태그는 그대로 남는다</b> — 직군은 추천 프리셋을 가를 뿐이다.
 */
@Getter
@NoArgsConstructor
public class OccupationUpdateRequest {
    @NotNull
    private Occupation occupation;
}
