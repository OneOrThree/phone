package com.oneorthree.notification;

interface PushTransport {

    enum Result { SENT, UNREGISTERED, RETRY }

    Result send(String token, RenderedPush push, boolean sound, String eventId);
}
