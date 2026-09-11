package com.oneorthree.phone.notification.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * 알림 producer 설정 등록 — {@code config} 패키지를 건드리지 않고 알림 하위트리 안에서 닫는다.
 *
 * <p>{@link NotificationDispatchProperties} 는 기본값이 코드에 있으므로 {@code application-*.yml}
 * 에 아무 줄도 더하지 않아도 기동한다. 전환 시점에 {@code notification.dispatch.mode=OUTBOX} 한 줄을
 * 환경별로 넣는다.
 */
@Configuration
@EnableConfigurationProperties(NotificationDispatchProperties.class)
public class NotificationProducerConfig {
}
