package com.oneorthree.chat.membership.client;

import com.oneorthree.chat.common.exception.UpstreamUnavailableException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.io.UncheckedIOException;
import java.time.Duration;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Data API 에 「이 사람이 속한 섬이 어디인가」를 묻는 유일한 창구.
 *
 * <p>채팅에는 그룹 테이블이 없다. 섬의 정본은 Data API 의 {@code groups}·{@code group_members} 이고,
 * 채팅은 그 답을 빌려 쓴다 — 정본을 복제해 두면 가입·탈퇴·강퇴가 채팅에서 늦거나 안 반영되고,
 * 그 어긋남은 「탈퇴한 사람이 아직 대화를 본다」로 나타난다.
 *
 * <p><b>지금은 요청자의 AT 를 그대로 실어 보낸다.</b> 목표 아키텍처 A9 는 서비스 간 호출을
 * {@code /internal/*} + 서비스 토큰 + {@code X-User-Id} 로 못 박았지만 그 표면은 아직 없다
 * (에픽 1643 몫). 그 전까지는 「요청자 본인의 토큰으로 본인 그룹을 조회」라 권한 상승이 없다 —
 * 채팅이 만들어 낼 수 있는 권한은 요청자가 이미 가진 것을 넘지 않는다. 전환 시 이 클래스 한 곳만
 * 바뀌도록 호출을 여기 가둬 뒀다.
 *
 * <h2>실패를 「비멤버」로 접지 않는다</h2>
 * 상류가 5xx·타임아웃일 때 빈 집합을 돌려주면 그건 「아무 섬에도 안 속함」이 되어, 장애 동안 전원이
 * 조용히 차단된다 — 화면에는 「이 섬의 멤버가 아닙니다」가 뜨고 아무도 원인을 못 찾는다. 그래서
 * {@link UpstreamUnavailableException} 으로 갈라 던져 503 으로 나가게 한다. 401/403 은 다르다 —
 * 그건 상류가 «판정을 내린» 것이라 빈 집합으로 접는다.
 */
@Slf4j
@Component
public class GroupClient {

    private final RestClient restClient;

    public GroupClient(@Value("${chat.data-api.base-url}") String baseUrl,
            @Value("${chat.data-api.timeout-ms:2000}") long timeoutMs) {
        this.restClient = RestClient.builder()
                .baseUrl(baseUrl)
                .requestFactory(timeoutFactory(timeoutMs))
                .build();
    }

    /**
     * 타임아웃을 «반드시» 지정하기 위한 팩토리.
     *
     * <p>기본 팩토리는 타임아웃이 무제한이다. 그 상태로 상류가 멈추면 STOMP 채널 스레드가 그대로
     * 잠기고, 채널 스레드는 풀이라 곧 전부 소진돼 <b>상류 한 곳의 지연이 채팅 전체의 정지</b>가 된다.
     */
    private static ClientHttpRequestFactory timeoutFactory(long timeoutMs) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofMillis(timeoutMs));
        factory.setReadTimeout(Duration.ofMillis(timeoutMs));
        return factory;
    }

    /**
     * 요청자가 속한 활성 그룹 id 집합.
     *
     * @param bearerToken {@code Authorization} 헤더 <b>통째로</b>({@code "Bearer …"} 포함). 접두를
     *                    떼서 넘기면 상류가 401 을 주고, 그 401 은 빈 집합으로 접혀 「비멤버」가 된다
     * @return 활성 그룹 id 들. 상류가 401/403 을 주면 빈 집합
     * @throws UpstreamUnavailableException 상류가 응답하지 않아 <b>판정을 내릴 수 없을 때</b>
     */
    public Set<UUID> fetchMyGroupIds(String bearerToken) {
        try {
            return restClient.get()
                    .uri("/api/v1/groups")
                    .header("Authorization", bearerToken)
                    // retrieve() 가 아니라 exchange() 인 이유: 4xx 를 «본문 변환 전에» 가로채야 하기 때문이다.
                    // retrieve() 경로에서는 상태 판정과 무관하게 본문을 List<GroupRef> 로 읽으려 들고,
                    // 401 의 본문은 에러 봉투({code, message})라 변환이 터진다 — 그 예외가 아래 catch 로
                    // 떨어지면 «판정 완료(비멤버)»가 «판정 불가(503)»로 뒤집힌다.
                    .exchange((request, response) -> {
                        HttpStatusCode status = response.getStatusCode();
                        if (status.is4xxClientError()) {
                            // 상류가 «판정»을 내렸다 — 이 토큰으로는 아무 그룹도 볼 수 없다.
                            log.debug("그룹 조회 거절 — status={}", status.value());
                            return Set.<UUID>of();
                        }
                        if (!status.is2xxSuccessful()) {
                            // 5xx = 판정 불가. 빈 집합으로 접으면 장애가 «전원 비멤버»로 읽힌다.
                            throw new UpstreamUnavailableException();
                        }
                        List<GroupRef> groups = response.bodyTo(new ParameterizedTypeReference<List<GroupRef>>() { });
                        return groups == null ? Set.<UUID>of()
                                : groups.stream()
                                        .map(GroupRef::groupId)
                                        .filter(Objects::nonNull)
                                        .collect(Collectors.toSet());
                    });
        } catch (UpstreamUnavailableException e) {
            throw e;
        } catch (RestClientException | UncheckedIOException e) {
            // 연결 불가·타임아웃·본문 변환 실패. 어느 쪽이든 «답을 못 받았다»이지 «아니오»가 아니다.
            log.warn("그룹 조회 실패 — 상류 응답 없음", e);
            throw new UpstreamUnavailableException();
        }
    }

    /**
     * 응답에서 {@code groupId} 하나만 뽑는 최소 DTO.
     *
     * <p>나머지 필드를 정의하지 않는 건 의도다 — 상류의 {@code GroupSummaryResponse} 가 필드를 늘리거나
     * 줄여도 채팅은 깨지지 않는다(Jackson 기본 {@code FAIL_ON_UNKNOWN_PROPERTIES=false}). 채팅이 아는
     * 것이 적을수록 상류가 자유롭게 바뀔 수 있다.
     */
    public record GroupRef(UUID groupId) {
    }
}
