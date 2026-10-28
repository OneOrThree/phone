package com.oneorthree.business.api;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 컨테이너 헬스체크용 {@code GET /health} — <b>서비스 포트에 있다</b>.
 *
 * <p>왜 actuator 를 쓰지 않는가: 관리 엔드포인트는 포트 9091 에 격리돼 있고 그 포트는 호스트에
 * publish 하지 않는다(포트 격리가 {@code /actuator/*} 를 사설로 유지하는 유일한 수단이다). compose 의
 * 헬스체크는 서비스 포트를 curl 하므로, 거기에 <b>정보를 담지 않는 최소 응답</b> 하나를 둔다.
 *
 * <p><b>상류 상태를 여기 담지 않는다.</b> 이 서비스의 일은 상류 장애를 503 으로 «전달»하는 것이고,
 * 상류가 흔들릴 때 컨테이너를 unhealthy 로 만들면 로드밸런서가 멀쩡한 인스턴스를 빼 버려 <b>그 503
 * 조차 못 내려준다</b>. 상류 건강은 서킷 메트릭으로 본다.
 *
 * <p>인증을 걸지 않는다 — {@code AccessTokenFilter} 는 {@code /api/*} 에만 등록돼 있다. 응답에 버전·
 * 호스트명 같은 값을 담지 않으므로 공개돼도 새는 정보가 없다.
 */
@RestController
public class HealthController {

    @GetMapping("/health")
    public ResponseEntity<Map<String, String>> health() {
        return ResponseEntity.ok(Map.of("status", "UP"));
    }
}
