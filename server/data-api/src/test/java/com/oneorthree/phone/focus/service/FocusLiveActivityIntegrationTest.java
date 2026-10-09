package com.oneorthree.phone.focus.service;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.focus.client.LiveActivityPushClient;
import com.oneorthree.phone.focus.dto.session.FocusSessionStartCommandRequest;
import com.oneorthree.phone.focus.dto.session.FocusVersionedCommandRequest;
import com.oneorthree.phone.focus.dto.session.LiveActivityRegistration;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.service.FocusSessionLifecycleService;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@SpringBootTest(properties = {"focus.session.start-enabled=true", "focus.live-activity.poll-ms=3600000"})
class FocusLiveActivityIntegrationTest {
    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired private AuthService auth;
    @Autowired private JwtProvider jwt;
    @Autowired private IslandMembershipService islands;
    @Autowired private FocusSessionLifecycleService focus;
    @Autowired private FocusLiveActivityService activities;
    @Autowired private JdbcTemplate jdbc;
    @MockitoBean private LiveActivityPushClient push;

    @Test
    void migratedRegistrationFollowsCommittedPauseAndFinish() {
        when(push.enabled()).thenReturn(true);
        when(push.send(any(), any(), any())).thenReturn(LiveActivityPushClient.Result.SENT);
        UUID user = jwt.extractUserId(auth.guestLogin().accessToken());
        UUID island = islands.create(user, new CreateIslandCommandRequest("라이브섬", null, false, null),
                UUID.randomUUID()).id();
        var session = focus.start(user, new FocusSessionStartCommandRequest(island, "수학", 25),
                UUID.randomUUID());
        var request = new LiveActivityRegistration("activity-1", "ab".repeat(32), "development", "black");
        activities.register(user, session.id(), request);
        activities.register(user, session.id(), request);
        assertThat(jdbc.queryForObject("select count(*) from focus_live_activities where session_id=?",
                Long.class, session.id())).isEqualTo(1);
        var paused = focus.pause(user, session.id(), new FocusVersionedCommandRequest(session.version()),
                UUID.randomUUID());
        activities.deliver(session.id());
        verify(push).send(any(), any(), argThat(payload ->
                ((Map<?, ?>) ((Map<?, ?>) payload.get("aps")).get("content-state")).get("phase").equals("rest")));
        focus.finish(user, session.id(), new FocusVersionedCommandRequest(paused.version()), UUID.randomUUID());
        jdbc.update("update focus_live_activities set next_attempt_at=now()-interval '1 second', "
                + "sent_timestamp=0 where session_id=?", session.id());
        activities.deliver(session.id());
        verify(push).send(any(), any(), argThat(payload -> ((Map<?, ?>) payload.get("aps")).get("event").equals("end")));
        assertThat(jdbc.queryForObject("select count(*) from focus_live_activities where session_id=?",
                Long.class, session.id())).isZero();
    }
}
