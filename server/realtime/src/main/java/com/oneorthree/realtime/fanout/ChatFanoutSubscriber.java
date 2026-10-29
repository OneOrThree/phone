package com.oneorthree.realtime.fanout;

import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.logging.LogContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.util.Objects;

/**
 * 다른 인스턴스가 {@code chat:fanout} 에 흘린 메시지를 받아 이 프로세스의 구독자에게 넘긴다.
 *
 * <p><b>자기가 보낸 것은 버린다.</b> Redis Pub/Sub 는 발행자 자신에게도 되돌려 주므로, 거르지 않으면
 * 발행한 인스턴스에 붙어 있는 사람만 같은 말을 두 번 본다 — 인스턴스가 한 대인 개발 환경에서는
 * «전원이 두 번 본다»로 나타나 눈에 띄지만, 두 대 이상이 되면 «일부만 두 번 본다»가 되어 훨씬 찾기 어렵다.
 *
 * <p>역직렬화 실패는 해당 건만 버리고 넘어간다. 리스너에서 예외를 밖으로 던지면 컨테이너가 그 구독을
 * 끊을 수 있고, 그러면 <b>이 인스턴스만 조용히 실시간 수신이 죽는다</b> — 로그도 한 줄뿐이라 한참 뒤에
 * 발견된다. 한 건을 버리는 쪽이 훨씬 싸다.
 *
 * <p>로그 연결(GROMO-2559): 받은 건마다 발행 쪽 원인({@code telemetry})과 {@code message_id} 를 처리 동안 문맥에 두고
 * {@code fanout.receive} 한 줄을 남긴다 — 자기 메아리도 남겨 «발행했고 돌아왔다»를 확인할 수 있게 한다. 이 스레드에서 넘긴
 * 로컬 전달은 아웃바운드 실행기 장식기가 같은 값을 물려받아 전달 직전 판정 로그까지 이어진다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ChatFanoutSubscriber implements MessageListener {

    private final ChatFanout chatFanout;
    private final ObjectMapper objectMapper;

    @Override
    public void onMessage(Message message, byte[] pattern) {
        ChatFanoutEvent event;
        try {
            event = objectMapper.readValue(
                    new String(message.getBody(), StandardCharsets.UTF_8), ChatFanoutEvent.class);
        } catch (RuntimeException e) {
            // 예외 «객체»를 남기지 않는다 — 역직렬화 예외 메시지에 깨진 JSON 조각(채팅 본문)이 실릴 수 있다(LLD §6).
            log.error("팬아웃 수신 처리 실패 — 이 건만 버린다. reason={}", e.getClass().getName());
            received("invalid");
            return;
        }
        try (LogContext scope = FanoutTelemetry.install(event.telemetry())) {
            scope.put(LogContext.MESSAGE_ID, event.message() == null ? null
                    : Objects.toString(event.message().messageId(), null));
            received(deliver(event));
        }
    }

    private String deliver(ChatFanoutEvent event) {
        try {
            if (chatFanout.instanceId().equals(event.originInstanceId())) {
                // 내가 발행한 것 — 로컬 전달은 broadcast() 에서 이미 끝났다.
                return "self_echo";
            }
            chatFanout.deliverLocally(event.message());
            return "delivered";
        } catch (RuntimeException e) {
            log.error("팬아웃 수신 처리 실패 — 이 건만 버린다. reason={}", e.getClass().getName());
            return "failed";
        }
    }

    private static void received(String result) {
        LogContext.info(log, LogContext.FANOUT_RECEIVE, "팬아웃 수신 — channel={} result={}",
                RedisKeys.FANOUT_CHANNEL, result);
    }
}
