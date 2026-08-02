package com.oneorthree.phone.group.api;

import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.notification.dto.PushDispatchSummaryResponse;
import com.oneorthree.phone.notification.service.BetResultNotificationService;
import com.oneorthree.phone.notification.service.ChallengeWindowEndNotificationService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * 푸시 수동 트리거의 관리자 키 게이트 — {@link GroupBetBatchControllerTest} 와 같은 3분기를 본다.
 * 이 두 엔드포인트는 실제 단말에 알림을 띄우므로 키 검증이 발송보다 먼저인지까지 잠근다.
 */
class GroupNotificationBatchControllerTest {

    private static final String CONFIGURED_KEY = "test-admin-key";

    private final BetResultNotificationService betResultNotificationService =
            mock(BetResultNotificationService.class);
    private final ChallengeWindowEndNotificationService challengeWindowEndNotificationService =
            mock(ChallengeWindowEndNotificationService.class);

    private GroupNotificationBatchController controllerWithKey(String configuredKey) {
        return new GroupNotificationBatchController(
                betResultNotificationService, challengeWindowEndNotificationService, configuredKey);
    }

    @Test
    @DisplayName("올바른 키 → 정산 결과 푸시가 실행되고 요약이 반환된다")
    void correctKeyRunsBetResultPush() {
        PushDispatchSummaryResponse summary = new PushDispatchSummaryResponse(3, 2, 1, 0, 5L);
        given(betResultNotificationService.sendBetResultNotifications()).willReturn(summary);

        ResponseEntity<PushDispatchSummaryResponse> response =
                controllerWithKey(CONFIGURED_KEY).notifyBetResults(CONFIGURED_KEY);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isEqualTo(summary);
    }

    @Test
    @DisplayName("올바른 키 → 창 종료 푸시가 실행되고 요약이 반환된다")
    void correctKeyRunsWindowEndPush() {
        PushDispatchSummaryResponse summary = new PushDispatchSummaryResponse(0, 0, 0, 0, 1L);
        given(challengeWindowEndNotificationService.sendWindowEndNotifications()).willReturn(summary);

        ResponseEntity<PushDispatchSummaryResponse> response =
                controllerWithKey(CONFIGURED_KEY).notifyChallengeWindowEnd(CONFIGURED_KEY);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isEqualTo(summary);
    }

    @Test
    @DisplayName("헤더 누락·키 불일치 → BATCH_KEY_INVALID(403), 발송 서비스는 호출되지 않는다")
    void invalidKeyRejected() {
        GroupNotificationBatchController controller = controllerWithKey(CONFIGURED_KEY);

        assertThatThrownBy(() -> controller.notifyBetResults(null))
                .isInstanceOf(GroupException.class)
                .extracting(e -> ((GroupException) e).getErrorCode())
                .isEqualTo(GroupErrorCode.BATCH_KEY_INVALID);
        assertThatThrownBy(() -> controller.notifyChallengeWindowEnd("wrong-key"))
                .isInstanceOf(GroupException.class)
                .extracting(e -> ((GroupException) e).getErrorCode())
                .isEqualTo(GroupErrorCode.BATCH_KEY_INVALID);
        assertThat(GroupErrorCode.BATCH_KEY_INVALID.getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
        verifyNoInteractions(betResultNotificationService, challengeWindowEndNotificationService);
    }

    @Test
    @DisplayName("서버에 키 미설정 → BATCH_KEY_NOT_CONFIGURED(503), 발송 서비스는 호출되지 않는다")
    void unconfiguredKeyRejected() {
        GroupNotificationBatchController controller = controllerWithKey("");

        assertThatThrownBy(() -> controller.notifyBetResults(CONFIGURED_KEY))
                .isInstanceOf(GroupException.class)
                .extracting(e -> ((GroupException) e).getErrorCode())
                .isEqualTo(GroupErrorCode.BATCH_KEY_NOT_CONFIGURED);
        assertThat(GroupErrorCode.BATCH_KEY_NOT_CONFIGURED.getStatus())
                .isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        verifyNoInteractions(betResultNotificationService, challengeWindowEndNotificationService);
    }
}
