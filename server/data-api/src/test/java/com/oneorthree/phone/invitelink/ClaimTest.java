package com.oneorthree.phone.invitelink;

import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.invitelink.repository.domain.GroupInviteLink;
import com.oneorthree.phone.invitelink.repository.domain.InviteLinkClick;
import com.oneorthree.phone.invitelink.service.InviteLinkMatchService;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
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
 * claim 통합 테스트 (계약 ④ {@code POST /api/v1/invite-links/claim}).
 *
 * <p>claim 은 "이 초대로 들어온 사람이 누구인가"를 확정하는 <b>결정론</b> 구간이다. 그래서
 * 최초 1회만 기록하고(뒤늦은 다른 유저의 claim 이 앞사람을 덮으면 어트리뷰션이 뒤집힌다),
 * 초대자 본인의 claim 은 무시한다(셀프 초대로 보상을 파먹는 경로를 미리 막는다).
 */
class ClaimTest extends InviteLinkTestSupport {

    @Autowired
    InviteLinkMatchService inviteLinkMatchService;
    @Autowired
    PlatformTransactionManager transactions;

    private Group group;
    private User inviter;
    private GroupInviteLink link;

    @BeforeEach
    void setUp() {
        group = newGroup("스터디");
        inviter = newUser("초대자");
        link = newLink("cl23cd45", group, inviter);
    }

    @Test
    @DisplayName("claim 은 최초 1회만 기록된다 — 뒤늦은 다른 유저가 덮어쓰지 못한다")
    void firstClaimWins() throws Exception {
        matchedClick();
        User joiner = newUser("가입자");
        User latecomer = newUser("나중사람");

        claim(joiner).andExpect(status().isOk());
        assertThat(onlyClickOf(link).getClaimedUserId()).isEqualTo(joiner.getId());
        assertThat(onlyClickOf(link).getClaimedAt()).isNotNull();

        claim(latecomer).andExpect(status().isOk());
        assertThat(onlyClickOf(link).getClaimedUserId()).isEqualTo(joiner.getId());
    }

    @Test
    @DisplayName("탈퇴 DML로 귀속을 지워도 소진된 클릭은 다시 claim 되지 않는다")
    void anonymizedClaimRemainsConsumed() throws Exception {
        matchedClick();
        User first = newUser("최초가입자");
        claim(first).andExpect(status().isOk());
        Instant claimedAt = onlyClickOf(link).getClaimedAt();
        assertThat(claimedAt).isNotNull();

        anonymizeClaim(first);
        claim(newUser("다음가입자")).andExpect(status().isOk());

        assertThat(onlyClickOf(link).getClaimedUserId()).isNull();
        assertThat(onlyClickOf(link).getClaimedAt()).isEqualTo(claimedAt);
    }

    @Test
    @DisplayName("가장 최근 클릭이 익명화된 소진 행이면 그 뒤의 미소진 클릭을 claim 한다")
    void anonymizedLatestClaimDoesNotHideOlderUnclaimedClick() throws Exception {
        matchedClick();
        User first = newUser("최초가입자");
        claim(first).andExpect(status().isOk());
        InviteLinkClick consumed = onlyClickOf(link);
        Instant claimedAt = consumed.getClaimedAt();
        anonymizeClaim(first);

        InviteLinkClick fresh = new InviteLinkClick(link.getId(), "0".repeat(64), "ios", IPHONE_UA);
        fresh.markMatched("older-unclaimed-device", "older-unclaimed-app");
        // 실행 속도나 시계 해상도에 의존하지 않고 조회 순서를 고정한다.
        ReflectionTestUtils.setField(fresh, "matchedAt", consumed.getMatchedAt().minusSeconds(1));
        fresh = clickRepository.save(fresh);
        User next = newUser("다음가입자");

        claim(next).andExpect(status().isOk());

        InviteLinkClick stillConsumed = clickRepository.findById(consumed.getId()).orElseThrow();
        InviteLinkClick newlyClaimed = clickRepository.findById(fresh.getId()).orElseThrow();
        assertThat(stillConsumed.getClaimedUserId()).isNull();
        assertThat(stillConsumed.getClaimedAt()).isEqualTo(claimedAt);
        assertThat(newlyClaimed.getClaimedUserId()).isEqualTo(next.getId());
        assertThat(newlyClaimed.getClaimedAt()).isNotNull();
    }

    @Test
    @DisplayName("도메인을 직접 호출해도 익명화된 클릭의 최초 claim 시각과 소진 상태를 보존한다")
    void domainRejectsReclaimAfterAnonymization() throws Exception {
        matchedClick();
        User first = newUser("최초가입자");
        claim(first).andExpect(status().isOk());
        Instant claimedAt = onlyClickOf(link).getClaimedAt();
        anonymizeClaim(first);
        InviteLinkClick consumed = onlyClickOf(link);

        assertThat(consumed.claim(newUser("다음가입자").getId(), inviter.getId())).isFalse();
        assertThat(consumed.getClaimedUserId()).isNull();
        assertThat(consumed.getClaimedAt()).isEqualTo(claimedAt);
    }

    @Test
    @DisplayName("동시 claim 2건 중 정확히 한 명만 기록된다 — lost update 로 앞사람이 덮이지 않는다")
    void concurrentClaimRecordsExactlyOneUser() throws Exception {
        matchedClick();
        User first = newUser("동시유저1");
        User second = newUser("동시유저2");

        // MockMvc 대신 서비스를 직접 부른다 — 검증 대상은 HTTP 계층이 아니라 락이 걸린 트랜잭션이고,
        // 프록시 호출이라 스레드마다 트랜잭션이 따로 열린다(MatchTest 의 동시 매치 테스트와 같은 구도).
        CyclicBarrier barrier = new CyclicBarrier(2);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            List<Future<Boolean>> futures = List.of(
                    executor.submit(claimAttempt(barrier, first.getId())),
                    executor.submit(claimAttempt(barrier, second.getId())));
            long recorded = futures.stream().map(this::get).filter(Boolean::booleanValue).count();

            assertThat(recorded).isEqualTo(1);
        } finally {
            executor.shutdownNow();
        }

        assertThat(onlyClickOf(link).getClaimedUserId()).isIn(first.getId(), second.getId());
    }

    @Test
    @DisplayName("초대자 본인의 claim 은 무시된다 — 셀프 초대 방지")
    void selfClaimIsIgnored() throws Exception {
        matchedClick();

        claim(inviter).andExpect(status().isOk());

        assertThat(onlyClickOf(link).getClaimedUserId()).isNull();
    }

    @Test
    @DisplayName("붙일 클릭이 없어도 200 — 링크 직행(UL) 유저는 클릭 행이 없다")
    void claimWithoutClickIsNoop() throws Exception {
        claim(newUser("직행유저")).andExpect(status().isOk());

        assertThat(clickRepository.findAll()).isEmpty();
    }

    @Test
    @DisplayName("없는 slug 는 404 SLUG_NOT_FOUND")
    void unknownSlugIsNotFound() throws Exception {
        mockMvc.perform(post("/api/v1/invite-links/claim")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization", bearer(newUser("가입자")))
                        .content("{\"slug\":\"zzzzzzzz\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SLUG_NOT_FOUND"));
    }

    @Test
    @DisplayName("토큰 없이는 claim 할 수 없다 — 401")
    void requiresAuthentication() throws Exception {
        mockMvc.perform(post("/api/v1/invite-links/claim")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slug\":\"" + link.getSlug() + "\"}"))
                .andExpect(status().isUnauthorized());
    }

    // ── 헬퍼 ──────────────────────────────────────────────────────────────

    /** 실제 탈퇴 서비스가 쓰는 동일 DML을 별도 커밋해 영속성 컨텍스트의 오래된 값을 피한다. */
    private void anonymizeClaim(User user) {
        new TransactionTemplate(transactions).executeWithoutResult(status ->
                assertThat(clickRepository.anonymizeClaimedUser(user.getId())).isEqualTo(1));
        InviteLinkClick anonymized = onlyClickOf(link);
        assertThat(anonymized.getClaimedUserId()).isNull();
        assertThat(anonymized.getClaimedAt()).isNotNull();
        assertThat(anonymized.isMatched()).isTrue();
    }

    /** 랜딩 클릭 → 매치까지 진행된 상태(= claim 대상이 존재하는 상태)를 만든다. */
    private void matchedClick() throws Exception {
        hitLanding(link.getSlug(), CLICK_IP);
        mockMvc.perform(post("/l/match")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Real-IP", CLICK_IP)
                        .content("{\"os\":\"ios\",\"deviceId\":\"d1\",\"appInstanceId\":\"a1\"}"))
                .andExpect(jsonPath("$.matched").value(true));
    }

    private ResultActions claim(User user) throws Exception {
        return mockMvc.perform(post("/api/v1/invite-links/claim")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", bearer(user))
                .content("{\"slug\":\"" + link.getSlug() + "\"}"));
    }

    private Callable<Boolean> claimAttempt(CyclicBarrier barrier, UUID userId) {
        return () -> {
            barrier.await(5, TimeUnit.SECONDS);
            return inviteLinkMatchService.claim(link.getSlug(), userId);
        };
    }

    private Boolean get(Future<Boolean> future) {
        try {
            return future.get(10, TimeUnit.SECONDS);
        } catch (Exception e) {
            throw new IllegalStateException("동시 claim 호출이 실패했습니다", e);
        }
    }
}
