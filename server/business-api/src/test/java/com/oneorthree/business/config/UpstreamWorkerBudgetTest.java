package com.oneorthree.business.config;

import com.oneorthree.business.common.http.ScreenComposer;
import com.oneorthree.business.upstream.data.DataAppearanceClient;
import com.oneorthree.business.upstream.data.DataAuthClient;
import com.oneorthree.business.upstream.data.DataConstructionClient;
import com.oneorthree.business.upstream.data.DataFocusClient;
import com.oneorthree.business.upstream.data.DataFriendClient;
import com.oneorthree.business.upstream.data.DataIslandClient;
import com.oneorthree.business.upstream.data.DataOutboxClient;
import com.oneorthree.business.upstream.data.DataQuestClient;
import com.oneorthree.business.upstream.data.DataRecordsClient;
import com.oneorthree.business.upstream.data.DataShopClient;
import com.oneorthree.business.upstream.notification.NotificationApiClient;
import com.oneorthree.business.upstream.realtime.RealtimeApiClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;

/** 설정 객체를 직접 검사하지 않고 실제 바인딩·클라이언트 구성의 기동 경계를 검증한다. */
class UpstreamWorkerBudgetTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(UpstreamClientConfig.class)
            .withBean(ObjectMapper.class, () -> JsonMapper.builder().build())
            .withPropertyValues(
                    "business.upstream.data.base-url=http://127.0.0.1:1",
                    "business.upstream.data.service-token=test-data-token",
                    "business.upstream.notification.base-url=http://127.0.0.1:2",
                    "business.upstream.notification.service-token=test-notification-token",
                    "business.upstream.realtime.base-url=http://127.0.0.1:4",
                    "business.upstream.realtime.service-token=test-realtime-token");

    @Test
    void defaultBudgetStartsAllThreeRealClientsAndComposer() {
        // 네트워크 요청 없이 실제 클라이언트와 실행기를 생성한다. runner가 종료 시 자원도 닫는다.
        runner.run(context -> assertThat(context).hasNotFailed()
                .hasSingleBean(UpstreamConfigProperties.class)
                .hasSingleBean(UpstreamClientConfig.class)
                .hasSingleBean(DataAuthClient.class)
                .hasSingleBean(DataFocusClient.class)
                .hasSingleBean(DataIslandClient.class)
                .hasSingleBean(DataFriendClient.class)
                .hasSingleBean(DataShopClient.class)
                .hasSingleBean(DataAppearanceClient.class)
                .hasSingleBean(DataQuestClient.class)
                .hasSingleBean(DataConstructionClient.class)
                .hasSingleBean(DataRecordsClient.class)
                .hasSingleBean(DataOutboxClient.class)
                .hasSingleBean(NotificationApiClient.class)
                .hasSingleBean(RealtimeApiClient.class)
                .hasSingleBean(ScreenComposer.class));
    }

    @ParameterizedTest
    @CsvSource({"7,4,4,4", "4,7,4,4", "4,4,7,4", "4,4,4,7", "8,5,3,3",
            "2147483647,2147483647,4,4", "2147483647,2147483647,2147483647,2147483647"})
    void rejectsSingleOrCombinedOverridesBeyondBudgetAtStartup(int data, int notification, int realtime, int composition) {
        configured(data, notification, realtime, composition).run(context -> {
            assertThat(context).hasFailed();
            assertThat(context.getStartupFailure()).hasRootCauseInstanceOf(IllegalArgumentException.class)
                    .hasStackTraceContaining("worker 합계").hasStackTraceContaining("18");
        });
    }

    @ParameterizedTest
    @CsvSource({"0,4,4,4", "4,0,4,4", "4,4,0,4", "4,4,4,0",
            "20,-8,2,2", "20,4,4,-12", "-2147483647,2147483647,4,4"})
    void zeroOrNegativePoolCannotCancelAnotherPoolAndPermitStartup(
            int data, int notification, int realtime, int composition) {
        configured(data, notification, realtime, composition).run(context -> {
            assertThat(context).hasFailed();
            // 합계만 만족해도 각 실제 풀의 양수 불변식까지 통과해야 기동할 수 있다.
            assertThat(context.getStartupFailure()).hasRootCauseInstanceOf(IllegalArgumentException.class);
        });
    }

    @Test
    void validRedistributionAtBoundaryBindsAndStartsInsteadOfEnforcingPerTargetDefault() {
        configured(9, 3, 3, 3).run(context -> {
            assertThat(context).hasNotFailed().hasSingleBean(DataAuthClient.class)
                    .hasSingleBean(ScreenComposer.class);
            // 상한 검증이 기본 객체가 아니라 실제 외부 설정으로 수행되는지 확인한다.
            UpstreamConfigProperties properties = context.getBean(UpstreamConfigProperties.class);
            assertThat(properties.getData().getMaxConnections()).isEqualTo(9);
            assertThat(properties.getNotification().getMaxConnections()).isEqualTo(3);
            assertThat(properties.getRealtime().getMaxConnections()).isEqualTo(3);
            assertThat(properties.getComposition().getPoolSize()).isEqualTo(3);
        });
    }

    /** realtime 도 양수 불변식의 대상이다 — 넷째 풀만 0·음수를 허용하면 «합계 18 이하»가 그 풀로 우회된다. */
    @ParameterizedTest
    @ValueSource(ints = {0, -8})
    void zeroOrNegativeRealtimePoolCannotStart(int realtime) {
        runner.withPropertyValues("business.upstream.realtime.max-connections=" + realtime).run(context -> {
            assertThat(context).hasFailed();
            assertThat(context.getStartupFailure()).hasRootCauseInstanceOf(IllegalArgumentException.class);
        });
    }

    /** realtime 은 합계에 «포함»된다 — Data·알림(4·4)+조합(4)에 realtime 7을 더하면 19 > 18이다. */
    @Test
    void realtimePoolCountsTowardTheBudget() {
        runner.withPropertyValues("business.upstream.realtime.max-connections=7").run(context -> {
            assertThat(context).hasFailed();
            assertThat(context.getStartupFailure()).hasRootCauseInstanceOf(IllegalArgumentException.class)
                    .hasStackTraceContaining("worker 합계").hasStackTraceContaining("18");
        });
    }

    private ApplicationContextRunner configured(int data, int notification, int realtime, int composition) {
        return runner.withPropertyValues(
                "business.upstream.data.max-connections=" + data,
                "business.upstream.notification.max-connections=" + notification,
                "business.upstream.realtime.max-connections=" + realtime,
                "business.upstream.composition.pool-size=" + composition);
    }
}
