package com.oneorthree.phone.league.api;

import com.oneorthree.phone.league.dto.LeagueBatchSummaryResponse;
import com.oneorthree.phone.league.exception.LeagueErrorCode;
import com.oneorthree.phone.league.exception.LeagueException;
import com.oneorthree.phone.league.service.LeagueBatchService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * 재개(resume) 트리거의 관리자 키 3분기 — 정상 키 / 헤더 누락 / 키 불일치, 그리고 서버 미설정(503).
 * GROMO-1239. GroupBetBatchControllerTest 와 같은 모양으로, 키 검증이 배치 서비스 호출보다 먼저
 * 실행되는지(실패 분기에서 서비스 무호출)까지 잠근다. weekStartAt 은 ISO instant 파싱만 컨트롤러
 * 책임이라 그 경계(정상 전달·형식 오류 400)도 여기서 고정한다. 기존 run 은 키 소급 부과 없이
 * 무키 유지가 결정 사항이라 그 계약도 함께 고정한다.
 */
class LeagueBatchControllerTest {

    private static final String CONFIGURED_KEY = "test-admin-key";
    private static final LeagueBatchSummaryResponse SUMMARY = new LeagueBatchSummaryResponse(
            Instant.parse("2026-08-03T15:00:00Z"), 1, 3, 0, 2, 0, 0, 1L);

    private final LeagueBatchService batchService = mock(LeagueBatchService.class);

    private LeagueBatchController controllerWithKey(String configuredKey) {
        return new LeagueBatchController(batchService, configuredKey);
    }

    @Test
    @DisplayName("올바른 관리자 키 → 재개가 실행되고 요약이 반환된다")
    void correctKeyRunsResume() {
        given(batchService.resumeWeeklyBatch(any(Instant.class), isNull(), isNull()))
                .willReturn(SUMMARY);

        ResponseEntity<LeagueBatchSummaryResponse> response =
                controllerWithKey(CONFIGURED_KEY).resumeWeeklyBatch(CONFIGURED_KEY, null, null);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isEqualTo(SUMMARY);
    }

    @Test
    @DisplayName("weekStartAt ISO instant 가 파싱돼 그대로 전달된다 — 과거 주차 복구 경로")
    void weekStartAtIsParsedAndPassedThrough() {
        Instant weekStartAt = Instant.parse("2026-07-26T15:00:00Z");
        given(batchService.resumeWeeklyBatch(any(Instant.class), eq(weekStartAt), isNull()))
                .willReturn(SUMMARY);

        ResponseEntity<LeagueBatchSummaryResponse> response = controllerWithKey(CONFIGURED_KEY)
                .resumeWeeklyBatch(CONFIGURED_KEY, "2026-07-26T15:00:00Z", null);

        assertThat(response.getBody()).isEqualTo(SUMMARY);
    }

    @Test
    @DisplayName("weekStartAt 형식 오류 → INVALID_WEEK_START(400), 배치 서비스는 호출되지 않는다")
    void malformedWeekStartAtRejected() {
        assertThatThrownBy(() -> controllerWithKey(CONFIGURED_KEY)
                        .resumeWeeklyBatch(CONFIGURED_KEY, "2026-07-27", null))
                .isInstanceOf(LeagueException.class)
                .extracting(e -> ((LeagueException) e).getErrorCode())
                .isEqualTo(LeagueErrorCode.INVALID_WEEK_START);
        assertThat(LeagueErrorCode.INVALID_WEEK_START.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
        verifyNoInteractions(batchService);
    }

    @Test
    @DisplayName("userIds 파라미터가 그대로 전달된다 — 실패 유저 표적 복구 경로")
    void userIdsArePassedThrough() {
        List<UUID> userIds = List.of(UUID.randomUUID(), UUID.randomUUID());
        given(batchService.resumeWeeklyBatch(any(Instant.class), isNull(), eq(userIds)))
                .willReturn(SUMMARY);

        ResponseEntity<LeagueBatchSummaryResponse> response =
                controllerWithKey(CONFIGURED_KEY).resumeWeeklyBatch(CONFIGURED_KEY, null, userIds);

        assertThat(response.getBody()).isEqualTo(SUMMARY);
    }

    @Test
    @DisplayName("헤더 누락 → BATCH_KEY_INVALID(403), 배치 서비스는 호출되지 않는다")
    void missingHeaderRejected() {
        assertThatThrownBy(() -> controllerWithKey(CONFIGURED_KEY).resumeWeeklyBatch(null, null, null))
                .isInstanceOf(LeagueException.class)
                .extracting(e -> ((LeagueException) e).getErrorCode())
                .isEqualTo(LeagueErrorCode.BATCH_KEY_INVALID);
        assertThat(LeagueErrorCode.BATCH_KEY_INVALID.getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
        verifyNoInteractions(batchService);
    }

    @Test
    @DisplayName("키 불일치 → BATCH_KEY_INVALID(403), 배치 서비스는 호출되지 않는다")
    void wrongKeyRejected() {
        assertThatThrownBy(() -> controllerWithKey(CONFIGURED_KEY)
                        .resumeWeeklyBatch("wrong-key", null, null))
                .isInstanceOf(LeagueException.class)
                .extracting(e -> ((LeagueException) e).getErrorCode())
                .isEqualTo(LeagueErrorCode.BATCH_KEY_INVALID);
        verifyNoInteractions(batchService);
    }

    @Test
    @DisplayName("서버에 키 미설정 → BATCH_KEY_NOT_CONFIGURED(503) — 올바른 키를 보내도 막힌다")
    void unconfiguredKeyReturns503() {
        assertThatThrownBy(() -> controllerWithKey("").resumeWeeklyBatch(CONFIGURED_KEY, null, null))
                .isInstanceOf(LeagueException.class)
                .extracting(e -> ((LeagueException) e).getErrorCode())
                .isEqualTo(LeagueErrorCode.BATCH_KEY_NOT_CONFIGURED);
        assertThat(LeagueErrorCode.BATCH_KEY_NOT_CONFIGURED.getStatus())
                .isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        verifyNoInteractions(batchService);
    }

    @Test
    @DisplayName("기존 run 은 키 없이 그대로 동작한다 — 키 소급 부과 없음(계약 변화 최소화)")
    void legacyRunStaysKeyless() {
        given(batchService.runWeeklyBatch()).willReturn(SUMMARY);

        ResponseEntity<LeagueBatchSummaryResponse> response = controllerWithKey("").runWeeklyBatch();

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isEqualTo(SUMMARY);
    }
}
