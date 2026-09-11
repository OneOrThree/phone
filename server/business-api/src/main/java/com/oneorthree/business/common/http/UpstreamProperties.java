package com.oneorthree.business.common.http;

import java.time.Duration;

/**
 * 한 상류의 접속·내구성 설정. <b>기본값을 무제한으로 두지 않는다</b> — 기본 RestClient 팩토리는
 * 타임아웃이 없어서, 상류가 멈추면 요청 스레드가 그대로 잠기고 곧 톰캣 풀이 소진돼
 * <b>상류 한 곳의 지연이 진입점 전체의 정지</b>가 된다.
 *
 * @param baseUrl        상류 주소
 * @param serviceToken   이 상류에만 보내는 서비스 토큰(A22 ㊀). 다른 상류에 실리면 최소 권한이 무너진다
 * @param connectTimeout 연결 수립 제한
 * @param readTimeout    응답 대기 제한
 * @param failureThreshold 연속 실패 몇 번에 서킷을 여는가
 * @param openDuration     서킷이 열려 있는 시간. 그 뒤 half-open 으로 한 건만 통과시킨다
 */
public record UpstreamProperties(
        String baseUrl,
        String serviceToken,
        Duration connectTimeout,
        Duration readTimeout,
        int failureThreshold,
        Duration openDuration) {
}
