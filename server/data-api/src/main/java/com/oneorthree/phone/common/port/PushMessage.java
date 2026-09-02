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

    /**
     * 정규화 생성자 — {@code data} 를 불변 사본으로 바꾼다.
     *
     * <p>한 {@code PushMessage} 가 수신자 여럿에게 재사용되므로, 호출측이 쥔 맵을 그대로 참조하면
     * 발송 도중의 변경이 아직 안 보낸 사람들에게까지 새어 들어간다. null 은 빈 맵으로 접어
     * {@link #toDataPayload()} 가 null 검사 없이 돌 수 있게 한다.
     *
     * @param title 알림 제목. null 이면 사일런트 메시지로 해석된다
     * @param body 알림 본문 — 치환이 끝난 최종 문자열
     * @param link 앱이 열 딥링크. null 이면 data payload 에서 키 자체가 빠진다
     * @param soundEnabled true 면 APNs 기본 사운드를 포함한다
     * @param data link 외에 실을 추가 키·값. 여기서 불변 사본으로 바뀌므로 호출측이 나중에
     *             원본 맵을 고쳐도 이미 만든 메시지에는 반영되지 않는다
     */
    public PushMessage {
        // 불변 사본 — 발송 직전까지 여러 유저에게 재사용되는 값이라 호출측 변경이 새 나가면 안 된다.
        data = data == null ? Map.of() : Map.copyOf(data);
    }

    /**
     * 추가 data 없는 기존 트리거용(리그·복귀·추월) — data.link 만 실린다.
     *
     * @param title 알림 제목. null 이면 사일런트로 해석되므로 표시 푸시에는 반드시 값이 있어야 한다
     * @param body 알림 본문 — 치환이 끝난 최종 문자열을 넘긴다
     * @param link 앱이 열 딥링크(예: {@code gromo://league}). null 이면 data 에서 키 자체가 빠진다
     * @param soundEnabled true 면 APNs 기본 사운드를 포함한다
     */
    public PushMessage(String title, String body, String link, boolean soundEnabled) {
        this(title, body, link, soundEnabled, Map.of());
    }

    /**
     * 사일런트(data-only) 메시지(GROMO-1281, FR-22) — 표시할 notification 없이 data 만 싣는다.
     * FCM 조립부는 {@link #isSilent()} 를 보고 notification 블록을 빼고 iOS
     * {@code content-available} 백그라운드 헤더를 얹는다. 앱은 표시 없이 깨어나 업로드 큐를
     * flush 한다(계약: {@code data.silent == 'flush'}).
     *
     * @param data 앱이 깨어나 읽을 데이터. 표시할 문구가 없으므로 <b>이 맵이 메시지의 전부</b>다 —
     *            비워 보내면 앱이 무엇을 하라는 신호인지 알 수 없다
     * @return title·body·link 가 모두 null 인 메시지. {@link #isSilent()} 가 true 로 판정한다
     */
    public static PushMessage silent(Map<String, String> data) {
        return new PushMessage(null, null, null, false, data);
    }

    /**
     * title 없음 = 사일런트 — 표시 푸시는 항상 제목이 있다(apns.md 문구 규약).
     *
     * @return true 면 FCM 조립부가 notification 블록을 빼고 iOS {@code content-available} 헤더를 얹는다.
     *         즉 <b>제목을 빠뜨린 표시 푸시는 조용히 사일런트가 되어 사용자에게 보이지 않는다</b>
     */
    public boolean isSilent() {
        return title == null;
    }

    /**
     * FCM {@code message.data} 로 나갈 최종 맵 — 추가 data 위에 link 를 얹는다.
     * link 가 null 이면 키 자체를 빼 FCM 이 null 값으로 400 을 뱉는 일을 막는다.
     *
     * @return 매 호출 새로 만든 맵. {@code link} 를 나중에 넣으므로 {@code data} 에 같은 이름의 키가
     *         있으면 <b>덮어쓰인다</b> — 추가 data 로 {@code link} 를 실어도 소용이 없다
     */
    public Map<String, String> toDataPayload() {
        Map<String, String> payload = new LinkedHashMap<>(data);
        if (link != null) {
            payload.put("link", link);
        }
        return payload;
    }
}
