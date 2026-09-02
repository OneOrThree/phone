package com.oneorthree.phone.invitelink;

import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.invitelink.repository.domain.GroupInviteLink;
import com.oneorthree.phone.invitelink.repository.domain.InviteLinkClick;
import com.oneorthree.phone.invitelink.dto.InviteMatchRequest;
import com.oneorthree.phone.invitelink.dto.InviteMatchResponse;
import com.oneorthree.phone.invitelink.service.InviteLinkMatchService;
import com.oneorthree.phone.invitelink.support.IpHasher;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.ResultActions;

import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * deferred 매치 통합 테스트 (계약 ③ {@code POST /l/match}).
 *
 * <p>클릭 → 설치 → 첫 실행이라는 실제 순서를 그대로 재현한다(랜딩 GET 으로 클릭을 만들고,
 * 같은 IP·OS 로 match 를 호출). 여기서 잠그는 핵심은 <b>소진</b>이다 — 한 클릭이 두 번 매치되면
 * 재설치할 때마다 같은 초대장이 되살아난다.
 */
class MatchTest extends InviteLinkTestSupport {

    @Autowired
    JdbcTemplate jdbcTemplate;
    @Autowired
    InviteLinkMatchService inviteLinkMatchService;
    @Autowired
    IpHasher ipHasher;

    private Group group;
    private User inviter;
    private GroupInviteLink link;

    @BeforeEach
    void setUp() {
        group = newGroup("스터디");
        inviter = newUser("초대자");
        link = newLink("mt23cd45", group, inviter);
    }

    @Test
    @DisplayName("같은 IP·OS 의 클릭은 slug 와 groupId 로 복원된다")
    void restoresInviteFromClick() throws Exception {
        hitLanding(link.getSlug(), CLICK_IP);

        match(CLICK_IP, "d1", "a1")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matched").value(true))
                .andExpect(jsonPath("$.slug").value(link.getSlug()))
                .andExpect(jsonPath("$.groupId").value(group.getId().toString()));

        InviteLinkClick click = onlyClickOf(link);
        assertThat(click.isMatched()).isTrue();
        assertThat(click.getMatchedAt()).isNotNull();
        assertThat(click.getMatchedDeviceId()).isEqualTo("d1");
        assertThat(click.getAppInstanceId()).isEqualTo("a1");
    }

    @Test
    @DisplayName("소진된 클릭은 재매치되지 않는다 — 재설치로 같은 초대가 되살아나지 않게")
    void consumedClickIsNotRematched() throws Exception {
        hitLanding(link.getSlug(), CLICK_IP);

        match(CLICK_IP, "d1", "a1").andExpect(jsonPath("$.matched").value(true));
        match(CLICK_IP, "d2", "a2")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matched").value(false))
                .andExpect(jsonPath("$.slug").doesNotExist())
                .andExpect(jsonPath("$.groupId").doesNotExist());
    }

    @Test
    @DisplayName("서로 다른 두 기기의 동시 매치가 한 클릭을 두 번 소진하지 못한다 — 정확히 하나만 성공")
    void concurrentMatchConsumesClickOnce() throws Exception {
        hitLanding(link.getSlug(), CLICK_IP);
        String ipHash = ipHasher.hash(CLICK_IP);

        // MockMvc 를 두 스레드에서 쓰지 않고 서비스를 직접 호출한다 — 검증 대상은 HTTP 계층이 아니라
        // 락이 걸린 트랜잭션이고, 프록시를 통한 호출이라 스레드마다 트랜잭션이 따로 열린다.
        // 기기 id 는 서로 다르게 둔다 — 같은 기기의 중복 호출은 재시도 멱등이 같은 결과를 돌려주는 게
        // 정답이라(retriedMatchIsIdempotent), 이중 소진 방지는 "다른 두 기기가 한 클릭을 다툰다"로 잠근다.
        CyclicBarrier barrier = new CyclicBarrier(2);
        Callable<InviteMatchResponse> first = matchAttempt(barrier, ipHash, "d1");
        Callable<InviteMatchResponse> second = matchAttempt(barrier, ipHash, "d2");

        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            List<Future<InviteMatchResponse>> futures =
                    List.of(executor.submit(first), executor.submit(second));
            long matched = futures.stream().map(this::get).filter(InviteMatchResponse::matched).count();

            assertThat(matched).isEqualTo(1);
        } finally {
            executor.shutdownNow();
        }

        assertThat(onlyClickOf(link).isMatched()).isTrue();
    }

    private Callable<InviteMatchResponse> matchAttempt(CyclicBarrier barrier, String ipHash, String deviceId) {
        return () -> {
            barrier.await(5, TimeUnit.SECONDS);
            return inviteLinkMatchService.match(ipHash, new InviteMatchRequest("ios", deviceId, "a1"));
        };
    }

    @Test
    @DisplayName("같은 기기의 재시도는 같은 결과를 돌려주고 클릭을 추가로 소진하지 않는다")
    void retriedMatchIsIdempotent() throws Exception {
        // 같은 fingerprint 로 클릭 2건 — 응답 유실 재시도가 두 번째 클릭까지 소진하면 안 된다.
        hitLanding(link.getSlug(), CLICK_IP);
        hitLanding(link.getSlug(), CLICK_IP);

        match(CLICK_IP, "d1", "a1")
                .andExpect(jsonPath("$.matched").value(true))
                .andExpect(jsonPath("$.slug").value(link.getSlug()));
        match(CLICK_IP, "d1", "a1")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matched").value(true))
                .andExpect(jsonPath("$.slug").value(link.getSlug()));

        long consumed = clickRepository.findByLinkId(link.getId()).stream()
                .filter(InviteLinkClick::isMatched).count();
        assertThat(consumed).isEqualTo(1);
    }

    @Test
    @DisplayName("기존 매치의 그룹이 죽어도 재시도는 다른 링크의 클릭을 소진하지 않는다 — 기기당 매치 1회")
    void retryAfterGroupDeathDoesNotConsumeOtherClicks() throws Exception {
        hitLanding(link.getSlug(), CLICK_IP);
        match(CLICK_IP, "d1", "a1").andExpect(jsonPath("$.matched").value(true));

        // 그 사이 그룹이 종료되고, 같은 fingerprint 로 "다른 링크"의 새 클릭이 쌓인다(공유 Wi-Fi 시나리오)
        group.close();
        groupRepository.save(group);
        GroupInviteLink other = newLink("other456", newGroup("다른방"), newUser("다른초대자"));
        hitLanding(other.getSlug(), CLICK_IP);

        // 재시도는 실패 응답으로 끝나야 한다 — 후보 소진 경로로 떨어지면 남의 클릭을 훔친다
        match(CLICK_IP, "d1", "a1")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matched").value(false));

        assertThat(onlyClickOf(other).isMatched()).isFalse();
    }

    @Test
    @DisplayName("그룹이 종료(ENDED)된 링크의 클릭은 매치 실패다 — 클릭은 소진해 죽은 후보로 남기지 않는다")
    void endedGroupClickIsNotMatched() throws Exception {
        hitLanding(link.getSlug(), CLICK_IP);
        group.close();
        groupRepository.save(group);

        match(CLICK_IP, "d1", "a1")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matched").value(false))
                .andExpect(jsonPath("$.slug").doesNotExist());

        // 소진하지 않으면 이 죽은 클릭이 계속 1순위 후보로 남아 뒤의 유효 후보를 가린다
        assertThat(onlyClickOf(link).isMatched()).isTrue();
    }

    @Test
    @DisplayName("시간창(3h) 밖의 클릭은 매치되지 않는다")
    void clickOutsideWindowIsIgnored() throws Exception {
        hitLanding(link.getSlug(), CLICK_IP);
        jdbcTemplate.update("UPDATE invite_link_clicks SET clicked_at = now() - interval '4 hours'");

        match(CLICK_IP, "d1", "a1").andExpect(jsonPath("$.matched").value(false));
    }

    @Test
    @DisplayName("다른 IP 는 매치되지 않는다")
    void differentIpDoesNotMatch() throws Exception {
        hitLanding(link.getSlug(), CLICK_IP);

        match("9.9.9.9", "d1", "a1").andExpect(jsonPath("$.matched").value(false));
    }

    @Test
    @DisplayName("OS 가 다르면 매치되지 않는다 — fingerprint 의 두 번째 축")
    void differentOsDoesNotMatch() throws Exception {
        hitLanding(link.getSlug(), CLICK_IP);

        postMatch("{\"os\":\"android\",\"deviceId\":\"d1\",\"appInstanceId\":\"a1\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matched").value(false));
    }

    @Test
    @DisplayName("app_instance_id 없이도 매치된다 — GA4 결합만 포기하고 초대는 복원한다")
    void matchesWithoutAppInstanceId() throws Exception {
        hitLanding(link.getSlug(), CLICK_IP);

        postMatch("{\"os\":\"ios\",\"deviceId\":\"d1\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matched").value(true));
    }

    @Test
    @DisplayName("형식이 어긋난 요청은 400 — 컬럼 길이를 넘는 deviceId·미지원 os")
    void rejectsMalformedRequests() throws Exception {
        String longDeviceId = "d".repeat(65);

        postMatch("{\"os\":\"ios\",\"deviceId\":\"" + longDeviceId + "\"}")
                .andExpect(status().isBadRequest());
        postMatch("{\"os\":\"windows\",\"deviceId\":\"d1\"}")
                .andExpect(status().isBadRequest());
    }

    // ── 헬퍼 ──────────────────────────────────────────────────────────────

    private ResultActions match(String ip, String deviceId, String appInstanceId) throws Exception {
        return mockMvc.perform(post("/l/match")
                .contentType(MediaType.APPLICATION_JSON)
                .header("X-Real-IP", ip)
                .content("{\"os\":\"ios\",\"deviceId\":\"" + deviceId
                        + "\",\"appInstanceId\":\"" + appInstanceId + "\"}"));
    }

    private ResultActions postMatch(String body) throws Exception {
        return mockMvc.perform(post("/l/match")
                .contentType(MediaType.APPLICATION_JSON)
                .header("X-Real-IP", CLICK_IP)
                .content(body));
    }

    private InviteMatchResponse get(Future<InviteMatchResponse> future) {
        try {
            return future.get(10, TimeUnit.SECONDS);
        } catch (Exception e) {
            throw new IllegalStateException("동시 매치 호출이 실패했습니다", e);
        }
    }
}
