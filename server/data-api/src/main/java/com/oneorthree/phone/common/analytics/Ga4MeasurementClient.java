package com.oneorthree.phone.common.analytics;

import java.util.Map;

/**
 * GA4 Measurement Protocol 전송 포트 — 서버가 소유한 퍼널 이벤트를 GA4 로 보낸다.
 *
 * <p>{@code invitelink/} 가 아니라 {@code common/} 에 두는 이유는 초대 링크 전용이 아니기 때문이다.
 * {@code group_joined} 같은 타 도메인 이벤트도 같은 통로를 쓴다.
 *
 * <p><b>구현 계약</b>: 비동기 fire-and-forget 이고 실패는 로그만 남긴다. 호출측 흐름을 절대 막지 않는다
 * — 분석 이벤트 하나 때문에 초대 랜딩이나 그룹 참여가 실패하면 안 된다.
 *
 * <p>이 인터페이스는 <b>WS 간 계약(스펙 §4-5)</b>이다. 시그니처 변경 금지.
 * 실구현({@code Ga4MeasurementClientImpl})은 WS-2 가 넣고, 그전까지는
 * {@link NoopGa4MeasurementClient} 가 자리를 지킨다.
 */
public interface Ga4MeasurementClient {

    /**
     * 앱 스트림 이벤트 — Firebase {@code app_instance_id} 기준이라 앱 SDK 이벤트와 같은 유저
     * 타임라인으로 결합된다.
     *
     * @param appInstanceId Firebase SDK 가 앱에서 뽑아 올려 준 {@code app_instance_id}.
     *                      우리가 만드는 값이 아니라 앱이 준 값이라 없을 수 있고, 없으면 GA4 가
     *                      이벤트를 조용히 버려 퍼널에서 사라진다
     * @param name GA4 이벤트 이름. GA4 규칙(영소문자·숫자·밑줄, 40자)을 지켜야 하고,
     *             한번 리포트에 자리 잡은 이름을 바꾸면 과거 데이터와 이어지지 않는다
     * @param params 이벤트 파라미터. 개인 식별 정보를 넣지 않는다 — GA4 는 우리 관할 밖 저장소다
     */
    void sendAppEvent(String appInstanceId, String name, Map<String, Object> params);

    /**
     * 웹 스트림 이벤트 — 익명 웹 클릭용. {@code syntheticClientId} 는 우리가 만든 합성 client_id.
     *
     * @param syntheticClientId 앱 설치 전 랜딩 클릭에는 Firebase id 가 없어 서버가 만들어 내는 값.
     *                          같은 클릭을 두 번 보내면 GA4 는 서로 다른 유저로 세므로 클릭당 하나여야 한다
     * @param name GA4 이벤트 이름. 앱 스트림과 이름을 맞춰야 설치 전후 퍼널이 한 줄로 이어진다
     * @param params 이벤트 파라미터. 랜딩은 미인증 트래픽이라 요청에서 온 값을 그대로 싣지 않는다
     */
    void sendWebEvent(String syntheticClientId, String name, Map<String, Object> params);
}
