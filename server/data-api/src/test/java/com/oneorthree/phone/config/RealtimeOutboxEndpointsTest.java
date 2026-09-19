package com.oneorthree.phone.config;

import com.oneorthree.phone.appearance.service.AppearanceEvents;
import com.oneorthree.phone.construction.service.IslandWalletEvents;
import com.oneorthree.phone.focus.service.FocusMemberEvents;
import com.oneorthree.phone.group.service.IslandJoinRequestEvents;
import com.oneorthree.phone.group.service.IslandMembershipEvents;
import com.oneorthree.phone.group.service.IslandNoticeEvents;
import com.oneorthree.phone.group.service.IslandStateEvents;
import com.oneorthree.phone.internal.service.InternalIslandMailboxService;
import com.oneorthree.phone.quest.service.IslandQuestEvents;
import com.oneorthree.phone.withdrawal.service.WithdrawalSatelliteCommandService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * REALTIME 사건 type 마다 배포되는 {@code application-satellites.yml} 허용목록에 HTTP 목적지가 있는지 본다
 * (GROMO-1954).
 *
 * <p>겨냥하는 실패: 목록에 없는 키의 행은 relay 가 permanent 로 적고 재시도가 멈추지 않아, 순서 축이 같은
 * 뒤 사건까지 전부 막힌다. 새 REALTIME 사건을 만들면 이 목록과 yml 을 같은 PR 에서 늘린다.
 */
class RealtimeOutboxEndpointsTest {

    private static final List<String> REALTIME_TYPES = List.of(
            WithdrawalSatelliteCommandService.EVENT_USER_WITHDRAWN,
            IslandStateEvents.EVENT_TYPE,
            IslandMembershipEvents.EVENT_TYPE,
            IslandNoticeEvents.EVENT_TYPE,
            IslandJoinRequestEvents.EVENT_TYPE,
            IslandWalletEvents.EVENT_TYPE,
            IslandQuestEvents.EVENT_TYPE,
            InternalIslandMailboxService.EVENT_TYPE,
            FocusMemberEvents.FOCUS_EVENT_TYPE,
            FocusMemberEvents.REST_EVENT_TYPE,
            AppearanceEvents.EVENT_MEMBER_APPEARANCE,
            AppearanceEvents.EVENT_ISLAND_APPEARANCE,
            AppearanceEvents.EVENT_PLAYBACK);

    @Test
    @DisplayName("REALTIME 사건 type 전부가 realtime POST /internal/events 로 Data 전용 토큰과 함께 등록돼 있다")
    void everyRealtimeTypeHasAnEndpoint() throws IOException {
        PropertySource<?> yml = new YamlPropertySourceLoader()
                .load("satellites", new ClassPathResource("application-satellites.yml")).get(0);

        assertThat(REALTIME_TYPES).allSatisfy(type -> {
            String prefix = "outbox.relay.endpoints[" + type + "].";
            assertThat(yml.getProperty(prefix + "target")).as(type).hasToString("REALTIME");
            assertThat(yml.getProperty(prefix + "url")).as(type)
                    .hasToString("${REALTIME_BASE_URL}/internal/events");
            assertThat(yml.getProperty(prefix + "method")).as(type).hasToString("POST");
            assertThat(yml.getProperty(prefix + "token")).as(type)
                    .hasToString("${SVC_TOKEN_DATA_TO_REALTIME}");
        });
        assertThat(yml.getProperty("outbox.relay.realtime-kafka-enabled"))
                .as("Kafka 는 선택이다 — 기본은 HTTP")
                .hasToString("${OUTBOX_RELAY_REALTIME_KAFKA_ENABLED:false}");
    }
}
