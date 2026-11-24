package com.oneorthree.notification.dispatch;

public interface PushTransport {

    enum Result { SENT, UNREGISTERED, RETRY }

    Result send(String token, RenderedPush push, boolean sound, String eventId);
}
