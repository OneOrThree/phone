package com.oneorthree.phone.common.exception;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.orm.ObjectOptimisticLockingFailureException;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 낙관락 충돌 응답 계약 — 과거 ROOM_FULL 오매핑의 회귀 방지.
 *
 * <p>내기 참가·정산이 같은 지갑(@Version)을 두고 경합하면 이 핸들러를 타는데, ROOM_FULL 로
 * 응답하면 그룹 참가와 무관한 충돌이 "정원 초과"로 보였다. 전용 코드 CONCURRENT_UPDATE(409)로
 * 응답해야 앱이 재시도 신호로 다룰 수 있다.
 */
class GlobalExceptionHandlerTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    @Test
    @DisplayName("낙관락 충돌은 ROOM_FULL 이 아니라 CONCURRENT_UPDATE(409)로 응답한다")
    void optimisticLockConflictMapsToConcurrentUpdate() {
        ResponseEntity<ErrorResponse> response = handler.handleOptimisticLock(
                new ObjectOptimisticLockingFailureException(Object.class, "any-id"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().getCode()).isEqualTo("CONCURRENT_UPDATE");
        assertThat(response.getBody().getMessage()).isEqualTo("잠시 후 다시 시도해주세요");
    }
}
