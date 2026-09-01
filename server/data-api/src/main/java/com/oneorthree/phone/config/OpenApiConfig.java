package com.oneorthree.phone.config;

import com.oneorthree.phone.common.auth.LoginUser;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springdoc.core.utils.SpringDocUtils;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    static {
        // @LoginUser 는 JwtFilter 가 심어 둔 값을 주입받는 자리라 클라이언트 입력이 아니다 (GROMO-363).
        // springdoc 에게는 무명 단순 타입 파라미터로 보여, 등록하지 않으면 userId 를 required 쿼리
        // 파라미터로 문서화한다 — 생성된 클라이언트가 실제로는 무시되는 값을 요구하게 된다.
        SpringDocUtils.getConfig().addAnnotationsToIgnore(LoginUser.class);
    }

    @Bean
    public OpenAPI openApi() {
        Info info = new Info()
                .title("Phone API 명세서")
                .version("v0.0.4")
                .description("핸드폰 중복 방지 API 문서입니다.");

        return new OpenAPI()
                .info(info);
    }
}
