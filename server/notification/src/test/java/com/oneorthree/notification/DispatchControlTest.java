package com.oneorthree.notification;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = "notification.drain-budget-seconds=0")
@AutoConfigureMockMvc
@ActiveProfiles("ci")
@Testcontainers
class DispatchControlTest {
    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", PG::getJdbcUrl);
        registry.add("spring.datasource.username", PG::getUsername);
        registry.add("spring.datasource.password", PG::getPassword);
    }

    @Autowired Store store;
    @Autowired DispatchControlService control;
    @Autowired MockMvc mvc;
    @MockitoBean PushTransport transport;

    @BeforeEach
    void reset() {
        store.update("TRUNCATE commands,admin_audit,deliveries,delivery_devices,job_runs CASCADE");
        store.update("UPDATE dispatch_control SET enabled=false,ever_opened=false");
    }

    @Test
    void oldOpenCannotUndoCloseAndRepeatedCloseStopsANewOpen() {
        control.open("member-1", "open-1");
        assertThat(control.close("member-1", "close-1")).containsEntry("drained", true);
        assertThatThrownBy(() -> control.open("member-1", "open-1"))
                .hasMessage("DISPATCH_CLOSED");
        control.open("member-1", "open-2");
        control.close("member-1", "close-1");
        assertThat(store.one("SELECT enabled,ever_opened FROM dispatch_control WHERE id=1"))
                .containsEntry("enabled", false).containsEntry("ever_opened", true);
    }

    @Test
    void closingWithAnActiveSendKeepsTheGateClosedAndReportsIncompleteDrain() {
        control.open("member-1", "open");
        store.update("INSERT INTO deliveries(id,event_id,user_id,kind,payload,lease_expires_at)"
                + " VALUES(?,'inflight',?,'FRIEND_REQUEST','{}'::jsonb,now()+interval '1 minute')",
                UUID.randomUUID(), UUID.randomUUID());
        assertThat(control.close("member-1", "close")).containsEntry("drained", false);
        assertThat(store.one("SELECT enabled FROM dispatch_control WHERE id=1"))
                .containsEntry("enabled", false);
    }

    @Test
    void replayQueuesOnlyCurrentJobsWithoutMarkingThemComplete() {
        Instant end = Instant.parse("2026-10-22T00:01:00Z");
        Map<String, Object> result = control.replay("member-1", "delivery-dispatch",
                Map.of("from", end.minusSeconds(15).toEpochMilli(), "to", end.toEpochMilli()), "replay");
        assertThat(result).containsEntry("queued", 3L).containsEntry("executed", false);
        assertThat(store.rows("SELECT completed_at FROM job_runs"))
                .hasSize(3).allSatisfy(row -> assertThat(row.get("completed_at")).isNull());
        assertThatThrownBy(() -> control.replay("member-1", "ack-reconcile", Map.of(), "old-job"))
                .hasMessage("UNKNOWN_JOB");
    }

    @Test
    void dispatchOpenRequiresConsoleIdentityAndRecordsItsActor() throws Exception {
        mvc.perform(post("/internal/admin/dispatch/open").header("Authorization", "Bearer test-business")
                        .header("Idempotency-Key", "forbidden"))
                .andExpect(status().isForbidden());
        mvc.perform(post("/internal/admin/dispatch/open").header("Authorization", "Bearer test-console")
                        .header("Idempotency-Key", "allowed"))
                .andExpect(status().isOk());
        assertThat(store.one("SELECT actor FROM admin_audit WHERE action='dispatch.opened'"))
                .containsEntry("actor", "member-1");
    }
}
