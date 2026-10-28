package com.oneorthree.realtime.sea;

import com.oneorthree.realtime.auth.ChatPrincipal;
import com.oneorthree.realtime.config.RealtimeSessionRegistry;
import com.oneorthree.realtime.config.StompTopics;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.DefaultMessage;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import tools.jackson.databind.ObjectMapper;

import java.time.Clock;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

class SeaRoomPublisherTest {

    @Test
    void remoteSnapshotReachesEveryLocalSessionThroughPersonalQueues() {
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        UUID room = UUID.randomUUID();
        RealtimeSessionRegistry sessions = new RealtimeSessionRegistry();
        sessions.register("a1", new ChatPrincipal(a, "Bearer a"));
        sessions.register("a2", new ChatPrincipal(a, "Bearer a"));
        sessions.register("b", new ChatPrincipal(b, "Bearer b"));
        SimpMessagingTemplate messaging = mock(SimpMessagingTemplate.class);
        ObjectMapper mapper = new ObjectMapper();
        Clock clock = Clock.systemUTC();
        SeaRoomPublisher publisher = new SeaRoomPublisher(messaging, mock(StringRedisTemplate.class), mapper,
                clock, sessions);
        var payload = mapper.readTree("{\"roomId\":\"" + room + "\",\"members\":[{\"userId\":\"" + a
                + "\"},{\"userId\":\"" + b + "\"}]}");
        SeaRoomEvent snapshot = SeaRoomEvent.of(SeaRooms.SNAPSHOT, room, clock.instant(), payload);
        String destination = StompTopics.seaRoomTopic(room);
        byte[] encoded = mapper.writeValueAsBytes(new SeaRoomFanoutEvent(UUID.randomUUID(), destination, snapshot));

        publisher.onMessage(new DefaultMessage(new byte[0], encoded), null);

        verify(messaging, org.mockito.Mockito.times(2))
                .convertAndSendToUser(eq(a.toString()), eq("/queue/sea"), eq(snapshot), anyMap());
        verify(messaging).convertAndSendToUser(eq(b.toString()), eq("/queue/sea"), eq(snapshot), anyMap());
        verify(messaging, never()).convertAndSend(destination, snapshot);
    }
}
