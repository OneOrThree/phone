package com.oneorthree.chat.common.exception;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.server.ResponseStatusException;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 그물의 <b>로그 레벨</b> — 「의도된 거절은 debug, 몰랐던 고장은 error」가 실제로 갈리는지.
 *
 * <p>응답 본문·상태만 보면 이 갈림은 확인되지 않는다. 그런데 이 클래스의 값어치 절반이 «로그가
 * 노이즈로 덮이지 않는 것»에 있어서, 레벨이 어긋나면 진짜 고장이 조용히 묻힌다 — 그것도 한참 뒤에야
 * 안다. 그래서 appender 를 붙여 레벨 자체를 단언한다.
 *
 * <p>특히 {@code ResponseStatusException} 은 {@code ErrorResponse} 를 <b>구현하면서 5xx 를 싣는다</b> —
 * 「우리가 몰랐던 고장」을 알리는 표준 관용구다. 인터페이스만으로 가르면 그게 스택트레이스 없이
 * debug 로 사라진다.
 */
class GlobalExceptionHandlerTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    private Logger logger;
    private ListAppender<ILoggingEvent> appender;

    @BeforeEach
    void attachAppender() {
        logger = (Logger) LoggerFactory.getLogger(GlobalExceptionHandler.class);
        appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        logger.setLevel(Level.DEBUG);
    }

    @AfterEach
    void detachAppender() {
        logger.detachAppender(appender);
    }

    @Test
    @DisplayName("ErrorResponse 를 구현해도 5xx 면 «항상» error + 스택트레이스로 남긴다")
    void fiveHundredIsAlwaysLoggedAsError() {
        ResponseEntity<ErrorResponse> response =
                handler.handleUnhandled(new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "boom"));

        assertThat(response.getStatusCode().value()).isEqualTo(500);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().getCode()).isEqualTo(CommonErrorCode.INTERNAL_ERROR.name());

        assertThat(appender.list).hasSize(1);
        assertThat(appender.list.get(0).getLevel()).isEqualTo(Level.ERROR);
        // 스택트레이스가 붙어야 원인을 쫓을 수 있다 — 레벨만 맞고 예외를 안 실으면 반쪽이다.
        assertThat(appender.list.get(0).getThrowableProxy()).isNotNull();
    }

    @Test
    @DisplayName("4xx 는 debug 다 — 오타 URL 하나가 error 로그를 만들면 진짜 고장이 묻힌다")
    void fourHundredStaysDebug() {
        handler.handleUnhandled(new ResponseStatusException(HttpStatus.NOT_FOUND, "no such path"));

        assertThat(appender.list).hasSize(1);
        assertThat(appender.list.get(0).getLevel()).isEqualTo(Level.DEBUG);
    }

    @Test
    @DisplayName("Spring 이 정한 상태를 그대로 쓴다 — 405·415 가 뭉뚱그려지지 않는다")
    void preservesSpringStatus() {
        assertThat(handler.handleUnhandled(
                new ResponseStatusException(HttpStatus.METHOD_NOT_ALLOWED)).getStatusCode().value())
                .isEqualTo(405);
        assertThat(handler.handleUnhandled(
                new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE)).getStatusCode().value())
                .isEqualTo(415);
    }

    @Test
    @DisplayName("ErrorResponse 가 아닌 예외는 500 + error 다 — 그물의 본래 자리")
    void unknownFailureIsError() {
        ResponseEntity<ErrorResponse> response = handler.handleUnhandled(new IllegalStateException("몰랐던 고장"));

        assertThat(response.getStatusCode().value()).isEqualTo(500);
        assertThat(appender.list.get(0).getLevel()).isEqualTo(Level.ERROR);
        // 원인 문자열은 본문에 «절대» 싣지 않는다 — SQL·호스트·키 이름이 섞여 나온다.
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().getMessage()).doesNotContain("몰랐던 고장");
    }
}
