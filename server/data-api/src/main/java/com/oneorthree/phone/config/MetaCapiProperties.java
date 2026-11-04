package com.oneorthree.phone.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Meta Conversions API 설정 (GROMO-2741) — 기본값은 «꺼짐»이라 환경변수가 없어도 기동한다.
 * 켜짐 + 데이터 세트·토큰이 모두 있어야 전송 작업이 만들어진다.
 */
@Getter
@Setter
@ConfigurationProperties(prefix = "meta.capi")
public class MetaCapiProperties {

    private boolean enabled = false;
    private String datasetId = "";
    private String accessToken = "";
    private String apiVersion = "v24.0";
    /** 비우면 최상위 test_event_code 를 보내지 않는다. */
    private String testEventCode = "";
    /** 테스트에서만 바꾼다. */
    private String baseUrl = "https://graph.facebook.com";
}
