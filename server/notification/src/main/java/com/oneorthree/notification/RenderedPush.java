package com.oneorthree.notification;

import java.util.LinkedHashMap;
import java.util.Map;

record RenderedPush(String title, String body, Map<String, String> data, boolean silent) {

    /** 수신 확인 태그(GROMO-2520)를 data 에 더한 사본. 실제 발송과 관리자 크기 검사가 같은 봉투를 만들게 한 곳에 둔다. */
    RenderedPush withDeliveryTag(String tag) {
        Map<String, String> tagged = new LinkedHashMap<>(data);
        tagged.put("deliveryTag", tag);
        return new RenderedPush(title, body, tagged, silent);
    }
}
