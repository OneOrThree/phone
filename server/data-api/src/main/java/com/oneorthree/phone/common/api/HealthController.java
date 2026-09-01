package com.oneorthree.phone.common.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 최소 헬스 체크 — {@code /health} 하나뿐이다. 인증 필터가 {@code /api/*} 에만 걸려 있어
 * 이 경로는 토큰 없이 열려 있다(로드밸런서·컨테이너 프로브가 그렇게 부를 수 있어야 한다).
 *
 * <p>애플리케이션이 <b>응답할 수 있는가</b>만 본다 — DB·외부 연동 상태는 확인하지 않는다.
 * 의존성까지 포함한 판정은 actuator 의 {@code /actuator/health} 쪽이다.
 */
@Tag(name = "Health", description = "헬스 체크 API Test")
@RestController
public class HealthController {
    /**
     * @return 고정 문자열. 값 자체에는 의미가 없고 200 이 떨어지는지만 본다 —
     *         응답 본문을 파싱하는 곳이 없으므로 형식을 바꿔도 무방하다
     */
    @Operation(summary = "서버 상태 확인", description = "서버 상태를 반환합니다.")
    @GetMapping("/health")
    public String health() {
        return "test";
    }
}
