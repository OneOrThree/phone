package com.oneorthree.phone.api.health;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name="Health", description = "헬스 체크 API Test")
@RestController
public class HealthController {
    @Operation(summary = "서버 상태 확인", description = "서버 상태를 반환합니다.")
    @GetMapping("/health")
    public String health() {
        return "test";
    }
}
