package com.oneorthree.phone.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {
    @Bean
    public OpenAPI openApi() {
        Info info = new Info()
                .title("Phone API 명세서")
                .version("v0.0.1")
                .description("핸드폰 중복 방지 API 문서입니다.");

        return new OpenAPI()
                .info(info);
    }
}
