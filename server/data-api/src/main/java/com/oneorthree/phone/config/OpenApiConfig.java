package com.oneorthree.phone.config;

import com.oneorthree.phone.common.auth.LoginUser;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springdoc.core.models.GroupedOpenApi;
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
                .title("Data API 명세서")
                .version("v0.0.4")
                .description("Business API 등 서버가 호출하는 내부 계약 문서입니다. 앱 공개 경로는 Business API 문서를 본다.");

        return new OpenAPI()
                .info(info);
    }

    /**
     * 게시 대상 그룹 — 서버 간 계약({@code /internal/**})만 담는다. 앱용 레거시
     * {@code /api/v1/**} 는 공개 문서에서 제외된다 (GROMO-2069).
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

    /**
     * 앱용 레거시 {@code /api/v1/**} 를 «격리»하는 그룹 — 기본 문서에 우연히 섞이지 않게 한다.
     * 게시·병합에는 쓰지 않으며, 잔존 계약 목록은
     * {@code docs/engineering/api-documentation/} 의 manifest 가 정본이다.
     * 경로가 전부 사라지면 이 그룹 자체를 없앤다.
     *
     * @return 레거시 경로만 담는 {@code legacy} 그룹
     */
    @Bean
    public GroupedOpenApi legacyApi() {
        return GroupedOpenApi.builder()
                .group("legacy")
                .pathsToMatch("/api/v1/**")
                .build();
    }
}
