package com.oneorthree.phone.group.api;

import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.dto.GroupBetSettlementSummaryResponse;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.service.GroupBetSettlementService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * 수동 정산 트리거의 관리자 키 3분기 — 정상 키 / 헤더 누락 / 키 불일치, 그리고 서버 미설정(503).
 *
 * <p>키 검증이 정산 서비스 호출보다 먼저 실행되는지(실패 분기에서 서비스 무호출)까지 잠근다 —
 * 검증 순서가 뒤집히면 키 없이도 정산이 돌아버린다. HTTP 상태 코드는 GroupException →
 * GlobalExceptionHandler 경로가 errorCode.getStatus() 를 그대로 쓰므로 enum 상태 단정으로 커버된다.
 */
class GroupBetBatchControllerTest {

    private static final String CONFIGURED_KEY = "test-admin-key";

    private final GroupBetSettlementService settlementService = mock(GroupBetSettlementService.class);

    private GroupBetBatchController controllerWithKey(String configuredKey) {
        return new GroupBetBatchController(settlementService, configuredKey);
    }

    @Test
    @DisplayName("올바른 관리자 키 → 정산 서비스가 실행되고 요약이 반환된다")
    void correctKeyRunsSettlement() {
        GroupBetSettlementSummaryResponse summary =
                new GroupBetSettlementSummaryResponse(LocalDate.of(2026, 8, 2), 0, 0, 0, 0, 0, 0, 1L);
        given(settlementService.settleDueBets((MissionCategory) null)).willReturn(summary);

        ResponseEntity<GroupBetSettlementSummaryResponse> response =
                controllerWithKey(CONFIGURED_KEY).settleDueBets(CONFIGURED_KEY, null);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isEqualTo(summary);
    }

    @Test
    @DisplayName("category 파라미터가 그대로 전달된다 — 스케줄 배치의 카테고리 분할을 수동 재현")
    void categoryIsPassedThrough() {
        GroupBetSettlementSummaryResponse summary =
                new GroupBetSettlementSummaryResponse(LocalDate.of(2026, 8, 2), 0, 0, 0, 0, 0, 0, 1L);
        given(settlementService.settleDueBets(MissionCategory.SCREEN_TIME)).willReturn(summary);

        ResponseEntity<GroupBetSettlementSummaryResponse> response =
                controllerWithKey(CONFIGURED_KEY).settleDueBets(CONFIGURED_KEY, MissionCategory.SCREEN_TIME);

        assertThat(response.getBody()).isEqualTo(summary);
    }

    @Test
    @DisplayName("헤더 누락 → BATCH_KEY_INVALID(403), 정산 서비스는 호출되지 않는다")
    void missingHeaderRejected() {
        assertThatThrownBy(() -> controllerWithKey(CONFIGURED_KEY).settleDueBets(null, null))
                .isInstanceOf(GroupException.class)
                .extracting(e -> ((GroupException) e).getErrorCode())
                .isEqualTo(GroupErrorCode.BATCH_KEY_INVALID);
        assertThat(GroupErrorCode.BATCH_KEY_INVALID.getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
        verifyNoInteractions(settlementService);
    }

    @Test
    @DisplayName("키 불일치 → BATCH_KEY_INVALID(403), 정산 서비스는 호출되지 않는다")
    void wrongKeyRejected() {
        assertThatThrownBy(() -> controllerWithKey(CONFIGURED_KEY).settleDueBets("wrong-key", null))
                .isInstanceOf(GroupException.class)
                .extracting(e -> ((GroupException) e).getErrorCode())
                .isEqualTo(GroupErrorCode.BATCH_KEY_INVALID);
        verifyNoInteractions(settlementService);
    }

    @Test
    @DisplayName("서버에 키 미설정 → BATCH_KEY_NOT_CONFIGURED(503) — 올바른 키를 보내도 막힌다")
    void unconfiguredKeyReturns503() {
        assertThatThrownBy(() -> controllerWithKey("").settleDueBets(CONFIGURED_KEY, null))
                .isInstanceOf(GroupException.class)
                .extracting(e -> ((GroupException) e).getErrorCode())
                .isEqualTo(GroupErrorCode.BATCH_KEY_NOT_CONFIGURED);
        assertThat(GroupErrorCode.BATCH_KEY_NOT_CONFIGURED.getStatus())
                .isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        verifyNoInteractions(settlementService);
    }

    @Test
    @DisplayName("프로파일 게이팅이 없다 — prod 포함 전 환경에 열린다(LLD §2.3). 인가는 관리자 키가 진다")
    void isNotProfileGatedSoProdCanRecoverManually() {
        // 24h 자동 환불은 최후 방어선일 뿐이다 — 그 전에 손으로 푸는 경로가 prod 에 없으면
        // 스케줄러 장애 회차의 참가비가 강제로 환불까지 흘러간다(GROMO-1411 후속).
        // @Profile 이 다시 붙으면 이 단정이 깨져 회귀를 잡는다.
        assertThat(GroupBetBatchController.class.getAnnotation(Profile.class)).isNull();
        // 대신 관리자 키 게이트는 반드시 남아 있어야 한다 — 위 403·503 분기가 그 증거다.
        assertThat(GroupBetBatchController.ADMIN_KEY_HEADER).isEqualTo("X-Batch-Admin-Key");
    }
}
