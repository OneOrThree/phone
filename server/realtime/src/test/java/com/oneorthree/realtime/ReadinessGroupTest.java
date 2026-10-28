package com.oneorthree.realtime;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.client.RestClient;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 준비성(readiness)이 <b>Redis 와 DB 를 포함</b>하는지 — 실제 엔드포인트 응답으로 확인한다.
 *
 * <p>기본 readiness 그룹은 {@code readinessState} 하나뿐이다. 그대로 두면 Redis 가 죽어도 컨테이너는
 * healthy 로 보이고 앞단은 트래픽을 계속 보낸다 — 그런데 이 서비스에서 Redis 는 팬아웃·멤버십·
 * 프레즌스가 전부 얹힌 하드 의존성이라, 그 상태의 채팅은 <b>「연결은 되는데 메시지가 안 오는」</b>
 * 더 헷갈리는 상태가 된다.
 *
 * <p>설정 한 줄이라 «지워도 아무 테스트도 안 깨지는» 종류다. 그래서 여기서 못 박는다.
 *
 * <p>{@code management.server.port} 를 비워 관리 엔드포인트를 본 포트로 끌어온다 — 운영에서는 9091
 * 로 격리하지만(호스트 미공개), 테스트에서 그 포트를 잡으면 확인만 번거로워진다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "management.server.port=",
        "management.endpoint.health.group.readiness.show-components=always",
})
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class ReadinessGroupTest {

    @LocalServerPort
    private int port;

    @Test
    @DisplayName("readiness 는 «정확히» readinessState·db·redis 다")
    void readinessIsExactlyTheHardDependencies() {
        String body = get("/actuator/health/readiness");

        // 들어 있어야 하는 것 — Redis 는 이 서비스의 하드 의존성이다.
        assertThat(body).as("BODY=%s", body).contains("\"db\"", "\"redis\"", "\"readinessState\"");

        // 들어 있으면 «안 되는» 것. 이 단언이 없으면 이 테스트는 아무것도 지키지 못한다 —
        // include 를 지우면 그룹이 «전체 지표»로 열리는데, 그때도 db·redis 는 여전히 들어 있어서
        // 포함 단언만으로는 통과해 버린다(실제로 그렇게 한 번 속았다).
        // diskSpace·ssl 은 채팅이 「대화를 나를 수 있는가」와 무관한데, 열어 두면 디스크 여유 하나로
        // 멀쩡한 채팅이 트래픽에서 빠진다.
        assertThat(body).as("BODY=%s", body)
                .doesNotContain("\"diskSpace\"")
                .doesNotContain("\"ssl\"")
                .doesNotContain("\"ping\"");

        assertThat(body).contains("\"status\":\"UP\"");
    }

    @Test
    @DisplayName("liveness 에는 상류 의존성을 넣지 않는다 — 넣으면 Redis 장애가 재시작 루프가 된다")
    void livenessStaysProcessLocal() {
        String body = get("/actuator/health/liveness");

        assertThat(body).as("BODY=%s", body).doesNotContain("\"redis\"").doesNotContain("\"db\"");
    }

    private String get(String path) {
        return RestClient.create().get().uri("http://localhost:" + port + path).retrieve().body(String.class);
    }
}
