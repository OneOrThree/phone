package com.oneorthree.notification;

import java.util.LinkedHashMap;
import java.util.Map;

record RenderedPush(String title, String body, Map<String, String> data, boolean silent) {

    /**
     * data 의 수신 확인 태그(GROMO-2520)를 «그 기기 등록의 값»으로 맞춘 사본. 실제 발송과 관리자 크기 검사가 같은 봉투를
     * 만들게 한 곳에 둔다. {@code tag} 가 null(V13 전 등록)이면 키를 <b>지운다</b> — 관리자 {@code dataTemplate} 이 같은 키를
     * 넣어 둬도 앱에 준 적 없는 값이 태그로 나가지 않는다.
     */
    RenderedPush withDeliveryTag(String tag) {
        Map<String, String> tagged = new LinkedHashMap<>(data);
        if (tag == null) {
            tagged.remove("deliveryTag");
        } else {
            tagged.put("deliveryTag", tag);
        }
        return new RenderedPush(title, body, tagged, silent);
    }
}
