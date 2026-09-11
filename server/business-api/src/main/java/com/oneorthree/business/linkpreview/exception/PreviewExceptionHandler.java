package com.oneorthree.business.linkpreview.exception;

import com.oneorthree.business.common.exception.ErrorResponse;
import com.oneorthree.business.linkpreview.PreviewController;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 미리보기 전용 예외 변환 — <b>{@link PreviewController} 에만</b> 붙는다.
 *
 * <h2>왜 스코프를 좁히고 우선순위를 올리나</h2>
 * <p>이 서비스에는 전역 {@code GlobalExceptionHandler} 가 있고 거기엔 {@code Exception} 그물이 있다.
 * advice 두 개가 같은 우선순위(기본값)로 공존하면 <b>어느 쪽이 먼저 조회되는지가 빈 이름 순서에 달린다</b> —
 * 그물이 먼저 걸리는 순간 {@link PreviewException} 이 500 으로 접히고, 429({@code Retry-After})·404 같은
 * 미리보기 계약이 통째로 사라진다. 그래서 ① {@code assignableTypes} 로 미리보기 컨트롤러에만 붙이고
 * ② {@link Ordered#HIGHEST_PRECEDENCE} 로 그물보다 먼저 조회되게 한다.
 *
 * <p>반대 방향도 막힌다 — 스코프가 없으면 이 advice 의 {@code DataAccessException}·검증 핸들러가
 * 조합 API(초대·결과 ack·알림 설정)의 응답 봉투까지 바꿔 버린다. 그쪽은 상류 판정을 그대로 중계하는
 * 별도 계약이라 손대면 안 된다.
 *
 * <p>봉투는 전역과 같은 {@link ErrorResponse}({@code code} · {@code message})다 — 앱이 {@code code} 로
 * 분기하므로 필드 이름과 값은 계약이다.
 */
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(assignableTypes = PreviewController.class)
public class PreviewExceptionHandler {

    private static final String MESSAGE = "미리보기 요청을 처리할 수 없습니다.";

    /**
     * 미리보기 실패. 상태는 코드에서 파생한다 — {@code RATE_LIMITED} 는 429 + {@code Retry-After},
     * {@code NOT_FOUND} 는 404, 나머지(비공개 링크·렌더 실패 등)는 요청 쪽 문제로 400 이다.
     */
    @ExceptionHandler(PreviewException.class)
    public ResponseEntity<ErrorResponse> preview(PreviewException error) {
        int status = switch (error.getCode()) {
            case "RATE_LIMITED" -> 429;
            case "NOT_FOUND" -> 404;
            default -> 400;
        };
        var response = ResponseEntity.status(status);
        if (status == 429) {
            response.header("Retry-After", "60");
        }
        return response.body(new ErrorResponse(error.getCode(), MESSAGE));
    }

    /**
     * 전용 Redis 장애 — 503 + {@code Retry-After}.
     *
     * <p>500 으로 접지 않는다: 캐시는 사본이라 잠시 뒤 같은 요청이 성공할 수 있고, 앱이 그걸 알아야
     * 재시도한다. 이 advice 가 미리보기에만 붙어 있으므로 조합 API 의 상류 503 계약과 섞이지 않는다.
     */
    @ExceptionHandler(DataAccessException.class)
    public ResponseEntity<ErrorResponse> unavailable(DataAccessException error) {
        return ResponseEntity.status(503).header("Retry-After", "10")
                .body(new ErrorResponse("SERVICE_UNAVAILABLE", "잠시 후 다시 시도해 주세요."));
    }
}
