package com.oneorthree.phone.common.port;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 푸시 메시지 페이로드
 * FE 계약(PR #104 push.ts): notification.title/body 표시 + data.link 딥링크 라우팅.
 *
 * <p>data 키는 오랫동안 link 하나였다(YAGNI). 그룹 챌린지 푸시(B4)에서 앱이 링크 라우팅 외에
 * <b>푸시 종류</b>를 알아야 해서(계약 §2 — 결과 모달 딥링크 합성 + GA4 {@code push_opened}
 * {@code type=BET_RESULT|CHALLENGE_WINDOW_END}) 임의 키를 실을 수 있게 확장했다.
 * 기존 4-인자 생성자는 그대로 두므로(추가 data 없음) 기존 트리거는 무영향이다.
 */
public record PushMessage(
        /** 알림 제목 (apns.md §3 문구). */
        String title,
        /** 알림 본문 — 치환 완료된 최종 문자열. */
        String body,
        /** data payload 의 link 키 값 (예: "gromo://league") — FE 가 content.data.link 로 소비. */
        String link,
        /** true 면 FCM apns.payload.aps.sound = "default" 포함, false 면 생략. */
        boolean soundEnabled,
        /** link 외에 추가로 실을 data 키·값(예: type·groupId). 비어 있으면 종전과 동일한 payload. */
        Map<String, String> data
) {

    public PushMessage {
        // 불변 사본 — 발송 직전까지 여러 유저에게 재사용되는 값이라 호출측 변경이 새 나가면 안 된다.
        data = data == null ? Map.of() : Map.copyOf(data);
    }

    /** 추가 data 없는 기존 트리거용(리그·복귀·추월) — data.link 만 실린다. */
    public PushMessage(String title, String body, String link, boolean soundEnabled) {
        this(title, body, link, soundEnabled, Map.of());
    }

    /**
     * 사일런트(data-only) 메시지(GROMO-1281, FR-22) — 표시할 notification 없이 data 만 싣는다.
     * FCM 조립부는 {@link #isSilent()} 를 보고 notification 블록을 빼고 iOS
     * {@code content-available} 백그라운드 헤더를 얹는다. 앱은 표시 없이 깨어나 업로드 큐를
     * flush 한다(계약: {@code data.silent == 'flush'}).
     */
    public static PushMessage silent(Map<String, String> data) {
        return new PushMessage(null, null, null, false, data);
    }

    /** title 없음 = 사일런트 — 표시 푸시는 항상 제목이 있다(apns.md 문구 규약). */
    public boolean isSilent() {
        return title == null;
    }

    /**
     * FCM {@code message.data} 로 나갈 최종 맵 — 추가 data 위에 link 를 얹는다.
     * link 가 null 이면 키 자체를 빼 FCM 이 null 값으로 400 을 뱉는 일을 막는다.
     */
    public Map<String, String> toDataPayload() {
        Map<String, String> payload = new LinkedHashMap<>(data);
        if (link != null) {
            payload.put("link", link);
        }
        return payload;
    }
}
