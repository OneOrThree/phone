package com.oneorthree.phone.config;

import com.oneorthree.phone.common.auth.LoginUser;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springdoc.core.utils.SpringDocUtils;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * springdoc(OpenAPI 3) 설정 — Swagger UI 는 {@code /swagger-ui/index.html} 에서 뜨고,
 * CI 의 {@code api-dog-generate} 워크플로가 여기서 나온 스펙을 그대로 문서로 굽는다.
 *
 * <p>static 블록의 {@code addAnnotationsToIgnore} 가 핵심이다 — {@code @LoginUser} 파라미터는
 * {@link JwtFilter} 가 심어 둔 값을 주입받는 자리라 클라이언트 입력이 아닌데, 등록해 두지 않으면
 * springdoc 이 이를 required 쿼리 파라미터로 문서화해 생성된 클라이언트가 무시되는 값을 요구하게 된다.
 */
@Configuration
public class OpenApiConfig {

    static {
        // @LoginUser 는 JwtFilter 가 심어 둔 값을 주입받는 자리라 클라이언트 입력이 아니다 (GROMO-363).
        // springdoc 에게는 무명 단순 타입 파라미터로 보여, 등록하지 않으면 userId 를 required 쿼리
        // 파라미터로 문서화한다 — 생성된 클라이언트가 실제로는 무시되는 값을 요구하게 된다.
        SpringDocUtils.getConfig().addAnnotationsToIgnore(LoginUser.class);
    }

    /**
     * 문서 최상단에 노출되는 제목·버전·설명만 지정한다. 경로·스키마는 컨트롤러와
     * {@code *ControllerDocs} 인터페이스에서 스캔되므로 여기에 나열하지 않는다.
     *
     * @return 메타 정보만 채운 OpenAPI 문서 루트
     */
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
