package com.oneorthree.chat.membership.client;

import com.oneorthree.chat.common.exception.UpstreamRejectedCredentialException;
import com.oneorthree.chat.common.exception.UpstreamUnavailableException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpStatus;
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
 *
 * <p><b>그 밖의 4xx(400·404 등)는 접지 않는다.</b> 그건 이 유저에 대한 판정이 아니라 우리 쪽 요청이나
 * 배포가 어긋났다는 신호라, 빈 집합으로 접으면 배선 사고가 「전원 비멤버」라는 조용한 차단으로 나타난다.
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
     * @return 활성 그룹 id 들과 <b>그 답을 캐시해도 되는지</b>. 상류가 401/403 을 주면 빈 집합이지만
     *         {@code cacheable=false} 다 — 그건 「이 사람은 아무 섬에도 없다」가 아니라
     *         「이 토큰으로는 못 본다」이기 때문이다
     * @throws UpstreamUnavailableException 상류가 응답하지 않아 <b>판정을 내릴 수 없을 때</b>
     */
    public Membership fetchMyGroupIds(String bearerToken) {
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
                        // 401 은 «비멤버»가 아니다 — 「토큰을 갱신하고 다시 붙어라」다. 빈 집합으로
                        // 접으면 앱은 갱신이 필요하다는 것을 알 길이 없어, 그 세션이 살아 있는 내내
                        // 모든 방이 「이 섬의 멤버가 아닙니다」로 막힌다(STOMP 세션은 CONNECT 때의
                        // 토큰을 그대로 들고 오래 산다). 그래서 코드를 갈라 올린다.
                        if (status.value() == HttpStatus.UNAUTHORIZED.value()) {
                            log.debug("그룹 조회 거절 — 토큰이 거절됐다(401)");
                            throw new UpstreamRejectedCredentialException();
                        }
                        // 403 은 판정이다 — 토큰은 멀쩡한데 이 자원을 못 본다. 갱신해도 달라지지 않으므로
                        // 「소속 없음」으로 접되 캐시하지는 않는다.
                        //
                        // 4xx 전체를 접지 않는 이유: 400(우리 요청이 잘못됨)·404(엔드포인트가 사라짐)는
                        // 상류가 이 유저에 대해 판정을 내린 게 아니라 «우리 쪽 또는 배포가 어긋났다»는
                        // 신호다. 그걸 빈 집합으로 접으면 배선 사고가 「전원 비멤버」라는 조용한 차단이 된다.
                        if (status.value() == HttpStatus.FORBIDDEN.value()) {
                            log.debug("그룹 조회 거절 — status=403");
                            return Membership.rejected();
                        }
                        if (!status.is2xxSuccessful()) {
                            // 5xx·그 밖의 4xx = 판정 불가. 빈 집합으로 접으면 장애가 «전원 비멤버»가 된다.
                            throw new UpstreamUnavailableException();
                        }
                        List<GroupRef> groups = response.bodyTo(new ParameterizedTypeReference<List<GroupRef>>() { });
                        return Membership.of(groups == null ? Set.of()
                                : groups.stream()
                                        .map(GroupRef::groupId)
                                        .filter(Objects::nonNull)
                                        .collect(Collectors.toSet()));
                    });
        } catch (UpstreamUnavailableException | UpstreamRejectedCredentialException e) {
            // 둘 다 «우리가 내린 판정»이다 — 아래 RestClientException 그물에 걸려 503 으로 뒤집히면 안 된다.
            throw e;
        } catch (RestClientException | UncheckedIOException e) {
            // 연결 불가·타임아웃·본문 변환 실패. 어느 쪽이든 «답을 못 받았다»이지 «아니오»가 아니다.
            log.warn("그룹 조회 실패 — 상류 응답 없음", e);
            throw new UpstreamUnavailableException();
        }
    }

    /**
     * 상류의 답 — <b>「소속이 없다」와 「이 토큰으로는 못 본다」를 구분</b>한다.
     *
     * <h3>왜 구분해야 하나</h3>
     * 둘 다 «빈 집합»이지만 캐시해도 되는지가 정반대다. 장시간 열린 STOMP 세션에서 AT 가 만료된
     * 직후 캐시 미스가 나면 상류가 401 을 주는데, 그걸 그냥 캐시하면 <b>유저가 즉시 토큰을 갱신해
     * 새로 붙어도 캐시는 {@code userId} 로만 조회되므로 새 토큰이 상류에 닿지 않는다</b> — 그동안
     * 모든 방에서 {@code NOT_A_MEMBER} 로 막힌다. 토큰 만료가 «2분간 전면 차단»으로 번지는 셈이다.
     *
     * @param groupIds 활성 그룹 id 들
     * @param cacheable 이 답을 캐시해도 되는가. 401/403 에서 나온 빈 집합이면 false
     */
    public record Membership(Set<UUID> groupIds, boolean cacheable) {

        /** 상류가 답한 «사실» — 캐시해도 된다. 빈 집합이면 정말 아무 섬에도 안 속한 것이다. */
        public static Membership of(Set<UUID> groupIds) {
            return new Membership(groupIds, true);
        }

        /**
     * 상류가 403 으로 거절했다 — 답은 비었지만 «이 사람의 소속»에 대한 사실이 아니다.
     *
     * <p>401 은 여기 오지 않는다. 그건 {@code UpstreamRejectedCredentialException} 으로 올라가
     * 앱에 「토큰을 갱신하라」가 전달된다.
     */
        public static Membership rejected() {
            return new Membership(Set.of(), false);
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
