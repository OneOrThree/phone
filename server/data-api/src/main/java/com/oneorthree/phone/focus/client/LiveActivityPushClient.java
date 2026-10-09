package com.oneorthree.phone.focus.client;

import java.util.Map;

public interface LiveActivityPushClient {
    enum Result { SENT, INVALID_TOKEN, RETRY }

    Result send(String token, String environment, Map<String, Object> payload);

    boolean enabled();
}
