package com.oneorthree.realtime.focus;

import com.oneorthree.realtime.common.exception.UpstreamUnavailableException;
import com.oneorthree.realtime.message.exception.ChatErrorCode;
import com.oneorthree.realtime.message.exception.ChatException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
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
 * 「이 사람이 지금 이 섬에서 집중 세션을 진행 중인가」를 <b>Data 정본에 묻는</b> 유일한 창구 (GROMO-1765).
 *
 * <h2>active 와 paused 를 <b>둘 다</b> 통과시킨다 (2026-09-20 재영님 결정)</h2>
 * 설계 문서는 한때 active 만 허용했지만, 휴식은 <b>같이 낚시에서 빠진 상태가 아니라 모닥불에 앉아 있는
 * 상태</b>다 — 쉬는 사람이 집중하는 사람을 응원하지 못하면 응원 기능의 절반이 사라진다. 그래서 통과
 * 기준은 「그 섬에서 <b>진행 중인</b> 본인 세션」이고, 거절되는 것은 완료·포기·남의 세션·다른 섬이다.
 *
 * <h2>왜 프레즌스 키로는 안 되는가</h2>
 * {@code presence:focus:{userId}} 는 존재 여부뿐이라 <b>어느 섬인지·어느 세션인지를 모른다</b>
 * (realtime-events LLD §7 이 그래서 「1765가 권위 있는 session projection 을 연결하기 전 emote 를
 * 허용하지 않는다」고 못 박았다). 응원은 「본인의 그 섬 진행 세션」이 전제라 그 둘을 알아야 한다.
 *
 * <h2>왜 새 표면을 만들지 않고 스냅샷을 읽는가</h2>
 * {@code GET /internal/islands/{islandId}/focus-members} 가 <b>이미</b> 그 섬의 활성 주민 중 진행 세션이
 * 있는 사람을 {@code (userId, sessionId, status)} 로 내려 준다 — 그 목록의 필터가
 * {@code IslandFocusMembersService.PROGRESSING = [ACTIVE, PAUSED]} 라 <b>휴식 중인 사람도 status
 * "paused" 로 실려 온다</b>(그래서 이 결정에 별도 표면이 필요 없었다). 거기에 내가 있고
 * {@code sessionId} 가 같다면 — 활성 계정·살아 있는 섬·<b>현재</b> 활성 주민·본인 진행 세션이 한 번의
 * 조회로 전부 증명된다. 판정 전용 엔드포인트를 새로 파면 같은 술어가 두 벌이 되고, 언젠가 한쪽만 바뀐다.
 *
 * <h2>이 답이 응원의 «수신» 자격이기도 하다</h2>
 * 발신 한 건이 이 조회 한 번을 부르고, 그 응답이 <b>그 섬에서 진행 중인 주민 전원</b>이다. 그래서
 * 「누가 이 응원을 받아도 되는가」가 <b>추가 비용 없이</b> 같은 응답에서 나온다 — realtime-events LLD
 * §4.2 가 「subscriber 수에 비례한 조회 비용은 배치 권한조회로 최적화한다」고 한 그 배치가 이것이다.
 * 전달 직전 판정을 구독자마다 다시 묻지 않아도 되는 이유다.
 *
 * <h2>캐시하지 않는다</h2>
 * {@code MembershipService} 의 120초 TTL 캐시를 쓰지 않는다 — 그 캐시는 「가입·탈퇴·강퇴가 즉시 반영되지
 * 않는다」고 스스로 적어 뒀고, realtime-events LLD §4.2 는 보호 채널에서 stale TTL 캐시를 최종 권한
 * 증거로 쓰지 말라고 한다. 빈도 제한이 발신 쪽 호출 수를 창당 1회로 누른다.
 *
 * <p><b>판정을 못 내리면 거절한다(fail-closed).</b> 상류 장애를 「집중 중」으로 접으면 그 시간 동안
 * 누구나 아무 섬에 응원을 꽂을 수 있다.
 */
@Slf4j
@Component
public class IslandFocusSessions {

    /**
     * 응원을 보낼 수 있는 상태 — Data 의 {@code FocusSessionView.STATUS_ACTIVE}·{@code STATUS_PAUSED}.
     *
     * <p><b>목록에 있다는 것만으로 통과시키지 않는다.</b> 지금은 그 목록이 이 둘뿐이지만, Data 가 나중에
     * 다른 상태를 같은 목록에 실으면 「목록에 있으면 OK」는 <b>조용히</b> 그것까지 허용한다. 이 집합이
     * 그 변화를 거절로 만든다.
     */
    private static final Set<String> PROGRESSING_STATUSES = Set.of("active", "paused");

    private final RestClient restClient;
    private final String serviceToken;

    public IslandFocusSessions(
            @Value("${realtime.focus.data-base-url:}") String baseUrl,
            @Value("${realtime.focus.data-service-token:}") String serviceToken,
            @Value("${realtime.focus.data-timeout-ms:1500}") long timeoutMs) {
        this.serviceToken = serviceToken;
        this.restClient = baseUrl.isBlank() ? null : RestClient.builder()
                .baseUrl(baseUrl)
                .requestFactory(timeoutFactory(timeoutMs))
                .build();
    }

    /**
     * 기본 팩토리는 타임아웃이 무제한이다. 그 상태로 상류가 멈추면 STOMP 채널 스레드가 그대로 잠기고,
     * 채널 스레드는 풀이라 곧 전부 소진돼 <b>상류 한 곳의 지연이 실시간 전체의 정지</b>가 된다.
     */
    private static ClientHttpRequestFactory timeoutFactory(long timeoutMs) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofMillis(timeoutMs));
        factory.setReadTimeout(Duration.ofMillis(timeoutMs));
        return factory;
    }

    /**
     * 그 섬에서 본인의 진행 중(active·paused) 집중 세션을 확인한다.
     *
     * @param islandId  응원이 나갈 섬
     * @param userId    발신자·구독자 — CONNECT 에서 검증한 주체여야 한다
     * @param sessionId 본인이 주장하는 세션. {@code null} 이면 「진행 세션이 있기만 하면 된다」
     *                  (구독 인가). 값이 있으면 그 세션이어야 한다(발신 인가)
     * @return 그 섬에서 <b>진행 중인 주민 전원</b>. 호출자가 이미 치른 조회에서 그대로 나오는 값이라
     *         공짜다 — 응원의 수신 자격이 정확히 이 집합이고, 발신자는 그 원소 하나일 뿐이다
     * @throws ChatException                {@code NOT_FOCUSING} — 종료·포기·남의 세션·다른 섬·비주민.
     *                                      <b>휴식은 여기 없다</b>(2026-09-20 결정)
     * @throws UpstreamUnavailableException 판정을 내릴 수 없을 때
     */
    public Set<UUID> requireActiveSession(UUID islandId, UUID userId, UUID sessionId) {
        if (restClient == null || serviceToken.isBlank()) {
            // 배선되지 않은 배포에서 응원만 조용히 열리지 않게 한다. 채팅·주민 관전은 영향이 없다.
            log.warn("응원 인가 상류가 배선되지 않았다 — 전량 거절한다");
            throw new UpstreamUnavailableException();
        }
        List<FocusMember> members = members(islandId, userId);
        if (members.stream().noneMatch(item -> userId.equals(item.userId())
                && PROGRESSING_STATUSES.contains(item.status())
                && (sessionId == null || sessionId.equals(item.sessionId())))) {
            throw new ChatException(ChatErrorCode.NOT_FOCUSING);
        }
        return members.stream()
                .filter(item -> item.userId() != null && PROGRESSING_STATUSES.contains(item.status()))
                .map(FocusMember::userId)
                .collect(Collectors.toUnmodifiableSet());
    }

    private List<FocusMember> members(UUID islandId, UUID userId) {
        try {
            return restClient.get()
                    .uri("/internal/islands/{islandId}/focus-members", islandId)
                    .header("Authorization", "Bearer " + serviceToken)
                    .header("X-User-Id", userId.toString())
                    // 4xx 를 «본문 변환 전에» 가로채야 한다 — 403 의 본문은 에러 봉투라 성공 타입으로
                    // 읽으려 들면 변환이 터지고, 그 예외가 아래 그물에 걸려 503 으로 뒤집힌다.
                    .exchange((request, response) -> {
                        HttpStatusCode status = response.getStatusCode();
                        if (!status.is2xxSuccessful()) {
                            // 403(비주민·섬 없음)도 «판정 불가»로 올린다. 이 조회의 성공 조건은
                            // 「목록에서 나를 찾는 것」이라, 목록을 못 받은 것과 목록에 없는 것을
                            // 구분할 필요가 없다 — 둘 다 응원을 보낼 수 없다.
                            log.debug("집중 주민 조회 실패 — status={}", status.value());
                            throw new UpstreamUnavailableException();
                        }
                        FocusMembers body = response.bodyTo(FocusMembers.class);
                        return body == null || body.items() == null ? List.<FocusMember>of()
                                : body.items().stream().filter(Objects::nonNull).toList();
                    });
        } catch (UpstreamUnavailableException e) {
            throw e;
        } catch (RestClientException | UncheckedIOException e) {
            log.warn("집중 주민 조회 실패 — 상류 응답 없음", e);
            throw new UpstreamUnavailableException();
        }
    }

    /**
     * 응답에서 판정에 필요한 셋만 뽑는다 — 나머지 필드(이름·과목·경과 시간)를 정의하지 않는 건 의도다.
     * 상류가 필드를 늘리거나 줄여도 이 판정은 깨지지 않는다.
     */
    record FocusMembers(List<FocusMember> items) {
    }

    record FocusMember(UUID userId, UUID sessionId, String status) {
    }
}
