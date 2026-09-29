package com.oneorthree.phone.user;

import com.oneorthree.phone.user.dto.NicknameCheckResponse;
import com.oneorthree.phone.user.dto.OccupationUpdateRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;

import java.util.UUID;

/**
 * {@code UserController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 *
 * <p>파라미터 단위 {@code @Parameter} 는 구현체에 남는다 — 자바가 파라미터 애노테이션을
 * 상속하지 않아 여기 붙이면 스펙에서 사라진다.
 */
@Tag(name = "user", description = "user 관련 API (생성, 조회, 변경)")
public interface UserControllerDocs {

    /**
     * @param nickname 검사할 닉네임 원문(공백 제거 전)
     * @param userId   본인 — 자기 현재 닉네임을 그대로 검사하면 사용 가능으로 나온다
     * @return 항상 200 이고 판정은 본문의 available 에만 실린다 — 형식 위반도 4xx 가 아니라 false 다
     */
    @Operation(summary = "닉네임 사용 가능 여부 확인",
            description = "닉네임이 사용 가능한지 판정한다 (GROMO-1215). 항상 200 + {available: boolean} — "
                    + "형식 위반(trim 후 2~10자 밖·빈문자열)도 available=false 로 내려간다(별도 4xx 없음). "
                    + "본인 제외 중복 검사라 자기 자신의 현재 닉네임은 available=true.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "판정 성공 — available 로 사용 가능 여부 반환"),
        @ApiResponse(responseCode = "401", description = "인증 없음")
    })
    ResponseEntity<NicknameCheckResponse> checkNickname(String nickname, UUID userId);

    /**
     * @param body   선택한 직군. 폐기된 직군이면 400
     * @param userId 본인
     * @return 본문 없는 204. 직군을 바꿔도 <b>이미 채택한 집중 태그는 그대로</b>다 —
     *         직군은 추천 프리셋만 가른다
     */
    @Operation(summary = "준비 시험 카테고리(occupation) 저장",
            description = "온보딩에서 선택한 시험 카테고리를 users.occupation 에 저장. 성공 시 204 반환.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "저장 성공"),
        @ApiResponse(responseCode = "400", description = "occupation 누락/유효하지 않은 값"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Void> updateOccupation(OccupationUpdateRequest body, UUID userId);
}
