package com.oneorthree.business.config;

import com.oneorthree.business.common.http.ScreenComposer;
import com.oneorthree.business.upstream.data.DataApiClient;
import com.oneorthree.business.upstream.link.LinkApiClient;
import com.oneorthree.business.upstream.notification.NotificationApiClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
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
                    "business.upstream.link.base-url=http://127.0.0.1:3",
                    "business.upstream.link.service-token=test-link-token");

    @Test
    void defaultBudgetStartsAllThreeRealClientsAndComposer() {
        // 네트워크 요청 없이 실제 클라이언트와 실행기를 생성한다. runner가 종료 시 자원도 닫는다.
        runner.run(context -> assertThat(context).hasNotFailed()
                .hasSingleBean(UpstreamConfigProperties.class)
                .hasSingleBean(UpstreamClientConfig.class)
                .hasSingleBean(DataApiClient.class)
                .hasSingleBean(NotificationApiClient.class)
                .hasSingleBean(LinkApiClient.class)
                .hasSingleBean(ScreenComposer.class));
    }

    @ParameterizedTest
    @CsvSource({"5,4,4,4", "4,5,4,4", "4,4,5,4", "4,4,4,5", "7,5,3,2",
            "2147483647,2147483647,4,4", "2147483647,2147483647,2147483647,2147483647"})
    void rejectsSingleOrCombinedOverridesBeyondBudgetAtStartup(int data, int notification, int link, int composition) {
        configured(data, notification, link, composition).run(context -> {
            assertThat(context).hasFailed();
            assertThat(context.getStartupFailure()).hasRootCauseInstanceOf(IllegalArgumentException.class)
                    .hasStackTraceContaining("worker 합계").hasStackTraceContaining("16");
        });
    }

    @ParameterizedTest
    @CsvSource({"0,4,4,4", "4,0,4,4", "4,4,0,4", "4,4,4,0",
            "20,-8,2,2", "20,4,4,-12", "-2147483647,2147483647,4,4"})
    void zeroOrNegativePoolCannotCancelAnotherPoolAndPermitStartup(
            int data, int notification, int link, int composition) {
        configured(data, notification, link, composition).run(context -> {
            assertThat(context).hasFailed();
            // 합계만 만족해도 각 실제 풀의 양수 불변식까지 통과해야 기동할 수 있다.
            assertThat(context.getStartupFailure()).hasRootCauseInstanceOf(IllegalArgumentException.class);
        });
    }

    @Test
    void validRedistributionAtBoundaryBindsAndStartsInsteadOfEnforcingPerTargetDefault() {
        configured(7, 3, 3, 3).run(context -> {
            assertThat(context).hasNotFailed().hasSingleBean(DataApiClient.class)
                    .hasSingleBean(NotificationApiClient.class).hasSingleBean(LinkApiClient.class)
                    .hasSingleBean(ScreenComposer.class);
            // 상한 검증이 기본 객체가 아니라 실제 외부 설정으로 수행되는지 확인한다.
            UpstreamConfigProperties properties = context.getBean(UpstreamConfigProperties.class);
            assertThat(properties.getData().getMaxConnections()).isEqualTo(7);
            assertThat(properties.getNotification().getMaxConnections()).isEqualTo(3);
            assertThat(properties.getLink().getMaxConnections()).isEqualTo(3);
            assertThat(properties.getComposition().getPoolSize()).isEqualTo(3);
        });
    }

    private ApplicationContextRunner configured(int data, int notification, int link, int composition) {
        return runner.withPropertyValues(
                "business.upstream.data.max-connections=" + data,
                "business.upstream.notification.max-connections=" + notification,
                "business.upstream.link.max-connections=" + link,
                "business.upstream.composition.pool-size=" + composition);
    }
}
