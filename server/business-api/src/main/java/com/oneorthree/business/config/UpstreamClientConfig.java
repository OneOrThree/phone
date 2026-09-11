package com.oneorthree.business.config;

import com.oneorthree.business.common.http.InternalHttpClient;
import com.oneorthree.business.common.http.UpstreamProperties;
import com.oneorthree.business.common.http.UpstreamTarget;
import com.oneorthree.business.upstream.data.DataApiClient;
import com.oneorthree.business.upstream.link.LinkApiClient;
import com.oneorthree.business.upstream.notification.NotificationApiClient;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import tools.jackson.databind.ObjectMapper;

/**
 * 상류 클라이언트 셋을 만든다 — <b>대상별로 별개의 인스턴스, 별개의 토큰</b>.
 *
 * <p>공통 팩토리를 두는 이유(§4): 타임아웃·재시도·서킷을 «처음부터» 한 자리에 두면 새 상류가 늘 때도
 * 그 규율이 자동으로 따라온다. 클라이언트마다 RestClient 를 직접 만들면 그중 하나가 타임아웃 없이
 * 뜨고, 그 한 곳이 진입점 전체를 멈춘다.
 *
 * <p><b>{@link InternalHttpClient} 를 빈으로 노출하지 않는다.</b> 대상 셋이 같은 타입이라 빈으로 두면
 * 주입이 이름에 의존하게 되고, 그 순간 「알림 자격으로 Data 를 호출」이 오타 한 번으로 가능해진다
 * (A22 ㉱ 의 최소 권한이 코드 구조로 서 있어야 한다). 각 클라이언트가 자기 인스턴스를 생성자에서만
 * 받는다.
 */
@Configuration
@EnableConfigurationProperties({UpstreamConfigProperties.class, CompatProperties.class})
public class UpstreamClientConfig {

    @Bean
    public DataApiClient dataApiClient(UpstreamConfigProperties properties, ObjectMapper objectMapper) {
        return new DataApiClient(
                new InternalHttpClient(UpstreamTarget.DATA, convert(properties.getData()), objectMapper));
    }

    @Bean
    public NotificationApiClient notificationApiClient(UpstreamConfigProperties properties,
            ObjectMapper objectMapper) {
        return new NotificationApiClient(new InternalHttpClient(
                UpstreamTarget.NOTIFICATION, convert(properties.getNotification()), objectMapper));
    }

    @Bean
    public LinkApiClient linkApiClient(UpstreamConfigProperties properties, ObjectMapper objectMapper) {
        return new LinkApiClient(
                new InternalHttpClient(UpstreamTarget.LINK, convert(properties.getLink()), objectMapper));
    }

    private UpstreamProperties convert(UpstreamConfigProperties.Target target) {
        return new UpstreamProperties(
                target.getBaseUrl(),
                target.getServiceToken(),
                target.getConnectTimeout(),
                target.getReadTimeout(),
                target.getFailureThreshold(),
                target.getOpenDuration());
    }
}
