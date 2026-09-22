package com.oneorthree.business.config;

import com.oneorthree.business.common.http.InternalHttpClient;
import com.oneorthree.business.common.http.ScreenComposer;
import jakarta.annotation.PreDestroy;
import com.oneorthree.business.common.http.UpstreamProperties;
import com.oneorthree.business.common.http.UpstreamTarget;
import com.oneorthree.business.upstream.data.DataApiClient;
import com.oneorthree.business.upstream.data.DataAuthClient;
import com.oneorthree.business.upstream.data.DataFocusClient;
import com.oneorthree.business.upstream.link.LinkApiClient;
import com.oneorthree.business.upstream.notification.NotificationApiClient;
import com.oneorthree.business.upstream.realtime.RealtimeApiClient;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * 상류 클라이언트 넷을 만든다 — <b>대상별로 별개의 인스턴스, 별개의 토큰</b>.
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

    private final Queue<InternalHttpClient> ownedClients = new ConcurrentLinkedQueue<>();
    /** 도메인별 Data 클라이언트가 나눠 쓰는 유일한 DATA 풀 — 첫 bean 이 만들고 나머지가 재사용한다. */
    private InternalHttpClient dataHttp;

    public UpstreamClientConfig(UpstreamConfigProperties properties) {
        properties.validateWorkerBudget();
    }

    @Bean
    public ScreenComposer screenComposer(UpstreamConfigProperties properties) {
        UpstreamConfigProperties.Composition composition = properties.getComposition();
        return new ScreenComposer(composition.getPoolSize(), composition.getQueueCapacity(), composition.getDeadline());
    }

    private InternalHttpClient client(UpstreamTarget target, UpstreamProperties properties, ObjectMapper mapper) {
        InternalHttpClient client = new InternalHttpClient(target, properties, mapper);
        ownedClients.add(client);
        return client;
    }

    /** 대상별 HTTP 풀과 worker를 애플리케이션 종료에 함께 회수한다. */
    @PreDestroy
    public void closeClients() throws IOException {
        IOException failure = null;
        for (InternalHttpClient client : ownedClients) {
            try {
                client.close();
            } catch (IOException e) {
                if (failure == null) {
                    failure = e;
                } else {
                    failure.addSuppressed(e);
                }
            }
        }
        if (failure != null) {
            throw failure;
        }
    }

    private InternalHttpClient dataHttp(UpstreamConfigProperties properties, ObjectMapper objectMapper) {
        if (dataHttp == null) {
            dataHttp = client(UpstreamTarget.DATA, convert(properties.getData()), objectMapper);
        }
        return dataHttp;
    }

    @Bean
    public DataApiClient dataApiClient(UpstreamConfigProperties properties, ObjectMapper objectMapper) {
        return new DataApiClient(dataHttp(properties, objectMapper));
    }

    @Bean
    public DataAuthClient dataAuthClient(UpstreamConfigProperties properties, ObjectMapper objectMapper) {
        return new DataAuthClient(dataHttp(properties, objectMapper));
    }

    @Bean
    public DataFocusClient dataFocusClient(UpstreamConfigProperties properties, ObjectMapper objectMapper) {
        return new DataFocusClient(dataHttp(properties, objectMapper));
    }

    @Bean
    public NotificationApiClient notificationApiClient(UpstreamConfigProperties properties,
            ObjectMapper objectMapper) {
        return new NotificationApiClient(client(
                UpstreamTarget.NOTIFICATION, convert(properties.getNotification()), objectMapper));
    }

    @Bean
    public LinkApiClient linkApiClient(UpstreamConfigProperties properties, ObjectMapper objectMapper) {
        return new LinkApiClient(
                client(UpstreamTarget.LINK, convert(properties.getLink()), objectMapper));
    }

    /** 우체통 저장소 어댑터(GROMO-1775). 넷째 대상, 넷째 토큰 — 셋과 같은 규율로 만든다. */
    @Bean
    public RealtimeApiClient realtimeApiClient(UpstreamConfigProperties properties, ObjectMapper objectMapper) {
        return new RealtimeApiClient(
                client(UpstreamTarget.REALTIME, convert(properties.getRealtime()), objectMapper));
    }

    private UpstreamProperties convert(UpstreamConfigProperties.Target target) {
        return new UpstreamProperties(
                target.getBaseUrl(),
                target.getServiceToken(),
                target.getConnectTimeout(),
                target.getReadTimeout(),
                target.getFailureThreshold(),
                target.getOpenDuration(),
                target.getMaxAttempts(),
                target.getRetryDelay(),
                target.getMaxConnections(),
                target.getQueueCapacity());
    }
}
