package com.oneorthree.phone.outbox.dto;

import com.oneorthree.phone.outbox.repository.domain.OutboxTarget;

import java.util.Map;

/**
 * 봉투 하나가 <b>어느 대상으로</b> 나가야 하는지의 요구 한 건.
 *
 * <p>대상마다 본문이 다를 수 있다 — 링크 폐기는 봉투 params 외에 {@code linkVersion}(폐기 대상)과
 * {@code membershipEpoch}(전이 후)를 <b>함께</b> 실어야 하고(ⓑ″), Kafka 는 정본 봉투 그대로다.
 * {@code payload} 가 {@code null} 이면 정본 봉투를 그대로 보낸다.
 *
 * <p><b>{@code endpointKey} 는 URL 이 아니라 논리 키다.</b> 실제 URL·method·caller 토큰은 서버 설정의
 * 허용목록에만 있다 — 저장된 payload 가 목적지를 고를 수 있으면 그 자체가 SSRF 구조가 된다.
 *
 * @param target      전달 대상
 * @param payload     이 대상에 보낼 본문. {@code null} 이면 정본 봉투
 * @param endpointKey HTTP 대상의 논리 엔드포인트 키. Kafka 대상은 {@code null}
 */
public record OutboxDeliveryRequest(OutboxTarget target, Map<String, Object> payload, String endpointKey) {

    public OutboxDeliveryRequest {
        if (target == null) {
            throw new IllegalArgumentException("전달 대상은 필수입니다.");
        }
        if (target == OutboxTarget.KAFKA && endpointKey != null) {
            throw new IllegalArgumentException("Kafka 대상에는 엔드포인트 키가 없습니다 — 토픽은 설정이 정한다.");
        }
        if (target != OutboxTarget.KAFKA && (endpointKey == null || endpointKey.isBlank())) {
            throw new IllegalArgumentException("HTTP 대상에는 논리 엔드포인트 키가 필요합니다 — URL 은 설정에만 있다.");
        }
    }

    /**
     * @return 정본 봉투를 그대로 보내는 Kafka 전달 요구
     */
    public static OutboxDeliveryRequest toKafka() {
        return new OutboxDeliveryRequest(OutboxTarget.KAFKA, null, null);
    }

    /**
     * @param endpointKey 링크 서버 명령의 논리 엔드포인트 키
     * @param payload     명령 본문. {@code null} 이면 정본 봉투
     * @return 링크 서버 HTTP 전달 요구
     */
    public static OutboxDeliveryRequest toLink(String endpointKey, Map<String, Object> payload) {
        return new OutboxDeliveryRequest(OutboxTarget.LINK, payload, endpointKey);
    }

    /**
     * @param endpointKey 알림 서버 명령의 논리 엔드포인트 키
     * @param payload     명령 본문. {@code null} 이면 정본 봉투
     * @return 알림 서버 HTTP 전달 요구
     */
    public static OutboxDeliveryRequest toNotification(String endpointKey, Map<String, Object> payload) {
        return new OutboxDeliveryRequest(OutboxTarget.NOTI, payload, endpointKey);
    }

    /** 새 섬 사건의 내구 전달 요구. 등록된 전용 transport가 없으면 relay가 선점하지 않는다. */
    public static OutboxDeliveryRequest toRealtime(String endpointKey, Map<String, Object> payload) {
        return new OutboxDeliveryRequest(OutboxTarget.REALTIME, payload, endpointKey);
    }
}
