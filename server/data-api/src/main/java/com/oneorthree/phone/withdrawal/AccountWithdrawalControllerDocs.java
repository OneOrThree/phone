package com.oneorthree.phone.withdrawal;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;

import java.util.UUID;

/**
 * {@code AccountWithdrawalController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 *
 * <p>태그 이름·설명은 {@code UserControllerDocs} 와 <b>글자 그대로 같다</b> (GROMO-1656) — 구현이 어느 패키지에 있든 앱이 보는 API 문서의
 * 그룹은 그대로여야 한다. 패키지 이동으로 문서 구조가 바뀌면 계약이 바뀐 것처럼 보인다.
 */
@Tag(name = "user", description = "user 관련 API (생성, 조회, 변경)")
public interface AccountWithdrawalControllerDocs {

    /**
     * @param userId 탈퇴할 본인
     * @return 본문 없는 204. 실제로는 행을 지우지 않고 PII 를 파기한 뒤 비활성 표시만 한다 —
     *         집중 이력은 익명화돼 남고, 소셜 연동만 하드 삭제된다(같은 소셜 계정으로 재가입 가능).
     *         다른 멤버가 남은 그룹의 방장이면 위임 전까지 400
     */
    @Operation(summary = "회원 탈퇴", description = "개인정보 파기 후 계정 삭제. 방장인 그룹은 위임 후 탈퇴 가능.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "탈퇴 완료"),
        @ApiResponse(responseCode = "400", description = "방장 위임 후 탈퇴 가능"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Void> withdraw(UUID userId);
}
