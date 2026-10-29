package com.oneorthree.realtime;

import org.slf4j.MDC;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessageHandler;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.ExecutorChannelInterceptor;
import org.springframework.messaging.support.ExecutorSubscribableChannel;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * 아웃바운드 채널 «전달 직전 판정 자리»의 MDC 를 기록하는 탐침 (GROMO-2559) — 판정 인터셉터 뒤에 붙어(실행기 인터셉터는 등록
 * 순) 판정이 통과시킨 프레임을 같은 실행 스레드·같은 작업에서 본다. 닫으면 원래 인터셉터 목록으로 되돌린다.
 */
final class OutboundSeat implements ExecutorChannelInterceptor, AutoCloseable {

    private static final long TIMEOUT_MILLIS = 10_000;

    private final ExecutorSubscribableChannel channel;
    private final List<ChannelInterceptor> original;
    private final String destination;
    private final List<Map<String, String>> seen = new CopyOnWriteArrayList<>();
    private final Map<String, String> threads = new ConcurrentHashMap<>();

    private OutboundSeat(ExecutorSubscribableChannel channel, String destination) {
        this.channel = channel;
        this.original = new ArrayList<>(channel.getInterceptors());
        this.destination = destination;
    }

    static OutboundSeat attach(ExecutorSubscribableChannel channel, String destination) {
        OutboundSeat seat = new OutboundSeat(channel, destination);
        channel.addInterceptor(seat);
        return seat;
    }

    @Override
    public Message<?> beforeHandle(Message<?> message, MessageChannel channel, MessageHandler handler) {
        if (destination.equals(SimpMessageHeaderAccessor.getDestination(message.getHeaders()))) {
            Map<String, String> mdc = MDC.getCopyOfContextMap();
            Map<String, String> copy = mdc == null ? Map.of() : Map.copyOf(mdc);
            seen.add(copy);
            String id = copy.getOrDefault("message_id", copy.get("event_id"));
            if (id != null) {
                threads.put(id, Thread.currentThread().getName());
            }
        }
        return message;
    }

    /** 그 키·값을 단 프레임이 이 자리를 지날 때까지 기다려 그때의 MDC 를 돌려준다. */
    Map<String, String> await(String key, String value) throws InterruptedException {
        long deadline = System.currentTimeMillis() + TIMEOUT_MILLIS;
        while (System.currentTimeMillis() < deadline) {
            for (Map<String, String> mdc : seen) {
                if (value.equals(mdc.get(key))) {
                    return mdc;
                }
            }
            Thread.sleep(50);
        }
        throw new AssertionError("전달 직전 자리에서 " + key + "=" + value + " 를 못 봤다. seen=" + seen);
    }

    /** 그 id 의 프레임을 처리한 실행 스레드 이름. */
    String thread(String id) {
        return threads.get(id);
    }

    @Override
    public void close() {
        // removeInterceptor 는 실행기 인터셉터 목록을 지우지 않는다 — 목록 전체를 되돌린다.
        channel.setInterceptors(original);
    }
}
