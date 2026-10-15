package com.oneorthree.business.config;

import com.oneorthree.business.auth.LoginUser;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springdoc.core.models.GroupedOpenApi;
import org.springdoc.core.utils.SpringDocUtils;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

/**
 * springdoc(OpenAPI 3) 설정 — CI 의 {@code api-dog-generate} 워크플로가
 * {@code /v0/api-docs/public} 그룹을 {@code business-api.openapi.json} 으로 굽는다 (GROMO-2069).
 *
 * <p>static 블록의 {@code addAnnotationsToIgnore} 가 핵심이다 — {@code @LoginUser} 파라미터는
 * {@link AccessTokenFilter} 가 심어 둔 값을 주입받는 자리라 클라이언트 입력이 아닌데, 등록해
 * 두지 않으면 springdoc 이 이를 required 쿼리 파라미터로 문서화한다.
 */
@Configuration
public class OpenApiConfig {

    /**
     * 공개 문서에 들어가는 경로 허용목록. 새 컨트롤러가 여기 없는 경로를 만들면 문서에서
     * «빠진다» — OpenApiAllowlistDriftTest 가 컨트롤러 애노테이션과 이 목록을 대조해
     * 그 드리프트를 빌드 실패로 잡는다.
     */
    public static final List<String> PUBLIC_PATH_PATTERNS = List.of(
            "/auth/**",
            "/friends/**",
            "/blocks/**",
            "/islands/**",
            "/rankings/**",
            "/invitations/**",
            "/me/**",
            "/screens/**",
            "/focus-sessions/**",
            "/letters/**",
            "/l/**",
            "/link-previews/**",
            // 호환 계약 — «당분간 유지». Apidog 병합 단계에서 business-api/legacy 폴더로 격리된다.
            "/api/v1/**");

    static {
        SpringDocUtils.getConfig().addAnnotationsToIgnore(LoginUser.class);
    }

    /**
     * 문서 최상단의 제목·버전·설명만 지정한다. 경로·스키마는 컨트롤러에서 스캔된다.
     *
     * @return 메타 정보만 채운 OpenAPI 문서 루트
     */
    @Bean
    public OpenAPI openApi() {
        return new OpenAPI()
                .info(new Info()
                        .title("Business API 명세서")
                        .version("v0.0.1")
                        .description("앱·QA가 사용하는 외부 공개 계약입니다. 서버 간 계약은 Data API 문서를 본다."));
    }

    /**
     * 게시 대상 그룹 — {@link #PUBLIC_PATH_PATTERNS} 의 «허용목록»만 담는다. denylist 가 아니라
     * allowlist 인 이유: 새 컨트롤러가 생겨도 검토 없이 공개 문서에 섞이지 않는다.
     * {@code /health}·{@code /actuator/**}·{@code /error} 는 여기 없으므로 문서에서 빠진다.
     *
     * @return 공개 경로만 담는 {@code public} 그룹
     */
    @Bean
    public GroupedOpenApi publicApi() {
        return GroupedOpenApi.builder()
                .group("public")
                .pathsToMatch(PUBLIC_PATH_PATTERNS.toArray(new String[0]))
                .build();
    }
}
