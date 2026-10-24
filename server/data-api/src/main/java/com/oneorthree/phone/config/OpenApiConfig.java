package com.oneorthree.phone.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springdoc.core.models.GroupedOpenApi;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 서버 간 내부 계약을 게시하는 OpenAPI 설정. */
@Configuration
public class OpenApiConfig {

    /**
     * 문서 최상단에 노출되는 제목·버전·설명만 지정한다. 경로·스키마는 컨트롤러와
     * {@code *ControllerDocs} 인터페이스에서 스캔되므로 여기에 나열하지 않는다.
     *
     * @return 메타 정보만 채운 OpenAPI 문서 루트
     */
    @Bean
    public OpenAPI openApi() {
        Info info = new Info()
                .title("Data API 명세서")
                .version("v0.0.4")
                .description("Business API 등 서버가 호출하는 내부 계약 문서입니다. 앱 공개 경로는 Business API 문서를 본다.");

        return new OpenAPI()
                .info(info);
    }

    /**
     * 게시 대상 그룹 — 서버 간 계약({@code /internal/**})만 담는다.
     *
     * @return 내부 경로만 담는 {@code internal} 그룹
     */
    @Bean
    public GroupedOpenApi internalApi() {
        return GroupedOpenApi.builder()
                .group("internal")
                .pathsToMatch("/internal/**")
                .build();
    }

}
