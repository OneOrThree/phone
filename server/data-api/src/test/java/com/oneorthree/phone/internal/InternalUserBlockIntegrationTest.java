package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.friend.service.FriendService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.service.UserBlockService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 차단 내부 표면 3종 (GROMO-1975) 을 <b>실제 Flyway PostgreSQL + InternalAuthFilter</b> 위에서 검증한다.
 *
 * <p>여기서만 확인되는 것: ① {@code (blocker_id, blocked_id)} 유니크 + {@code ON CONFLICT DO NOTHING}
 * 조합이 실제 Postgres 에서 동시·중복 차단을 한 행으로 접는가(create-drop 스키마에서도 제약은 있지만
 * 충돌 시 아무도 500 을 내지 않는 계약은 배포 배선에서만 보인다) ② 허용목록·{@code X-User-Id} 대조가
 * 실제 필터로 도는가 ③ 차단이 친구 목록·검색의 제외 대조표로 실제 쿼리에 들어가는가.
 * 받은함 제외는 {@code InternalLetterIntegrationTest} 가 같은 쿼리 축으로 본다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class InternalUserBlockIntegrationTest {

    private static final String TOKEN = "test-block-business";
    private static final String DATE = "2026-09-18";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        // 배포 yml 의 3줄 + 이 파일이 친구 제외를 증명하려고 여는 2줄.
        // yml 자체와 컨트롤러의 대조는 InternalUserBlockAllowlistTest 가 맡는다.
        registry.add("internal.api.callers.business.allow[0]", () -> "GET /internal/users/*/blocks");
        registry.add("internal.api.callers.business.allow[1]", () -> "POST /internal/users/*/blocks");
        registry.add("internal.api.callers.business.allow[2]", () -> "DELETE /internal/users/*/blocks/*");
        registry.add("internal.api.callers.business.allow[3]", () -> "GET /internal/users/*/friends");
        registry.add("internal.api.callers.business.allow[4]", () -> "GET /internal/users/*/friend-search");
    }

    @Autowired
    MockMvc mvc;
    @Autowired
    FriendService friendService;
    @Autowired
    UserBlockService userBlockService;
    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    JdbcTemplate jdbc;

    // ---------------------------------------------------------------- 1. 계약

    @Test
    @DisplayName("차단 → 목록 → 재차단(멱등) → 해제 → 재해제(멱등) 가 한 바퀴 돌고 행 수는 항상 ≤1")
    void blockListAndUnblockAreIdempotent() throws Exception {
        UUID a = newUser();
        UUID b = newUser();
        nickname(b, "차단상대");

        as(a, post(path(a, "/blocks")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"blockedUserId\":\"" + b + "\"}"))
                .andExpect(status().isNoContent());
        // 같은 POST 는 두 번째 행을 만들지 않는다 — 유니크 + ON CONFLICT 가 멱등을 담보한다.
        as(a, post(path(a, "/blocks")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"blockedUserId\":\"" + b + "\"}"))
                .andExpect(status().isNoContent());
        assertThat(countBlocks(a, b)).isEqualTo(1);

        as(a, get(path(a, "/blocks")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value(b.toString()))
                .andExpect(jsonPath("$[0].name").value("차단상대"));
        // 목록은 blocker 방향만 본다 — 상대의 목록은 비어 있다.
        as(b, get(path(b, "/blocks")))
                .andExpect(status().isOk())
                .andExpect(content().json("[]"));

        as(a, delete(path(a, "/blocks/" + b))).andExpect(status().isNoContent());
        // 없는 관계의 해제도 성공이다 — 재시도·중복 탭이 404 로 새지 않는다.
        as(a, delete(path(a, "/blocks/" + b))).andExpect(status().isNoContent());
        // 처음부터 존재하지 않는 UUID도 같은 0행 DELETE라 성공한다.
        as(a, delete(path(a, "/blocks/" + UUID.randomUUID()))).andExpect(status().isNoContent());
        assertThat(countBlocks(a, b)).isZero();
        as(a, get(path(a, "/blocks")))
                .andExpect(status().isOk())
                .andExpect(content().json("[]"));
    }

    @Test
    @DisplayName("자기 차단은 400 SELF_BLOCK, 대상 부재·탈퇴는 404 TARGET_USER_NOT_FOUND, 행은 남지 않는다")
    void selfAndMissingTargetsAreRejected() throws Exception {
        UUID a = newUser();
        UUID withdrawn = newUser();
        jdbc.update("update users set is_deleted = true where id = ?", withdrawn);

        as(a, post(path(a, "/blocks")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"blockedUserId\":\"" + a + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("SELF_BLOCK"));
        as(a, post(path(a, "/blocks")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"blockedUserId\":\"" + UUID.randomUUID() + "\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("TARGET_USER_NOT_FOUND"));
        as(a, post(path(a, "/blocks")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"blockedUserId\":\"" + withdrawn + "\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("TARGET_USER_NOT_FOUND"));

        // 요청자 자체가 없으면 USER_NOT_FOUND — 앱의 재로그인 분기가 타는 코드다.
        UUID ghost = UUID.randomUUID();
        as(ghost, post(path(ghost, "/blocks")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"blockedUserId\":\"" + a + "\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("USER_NOT_FOUND"));

        assertThat(countBlocks(a, a)).as("자기 차단 거절은 행을 남기지 않는다").isZero();
        assertThat(countBlocks(a, withdrawn)).as("탈퇴 대상 거절은 행을 남기지 않는다").isZero();
    }

    @Test
    @DisplayName("경로의 유저와 X-User-Id 가 다르면 403, 허용목록 밖 메서드도 403 이다")
    void subjectAndAllowlistAreEnforced() throws Exception {
        UUID a = newUser();
        UUID b = newUser();

        mvc.perform(get(path(a, "/blocks"))
                        .header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", b.toString()))
                .andExpect(status().isForbidden());
        as(a, put(path(a, "/blocks/" + b)).contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
                .andExpect(status().isForbidden());
        as(a, delete(path(a, "/blocks"))).andExpect(status().isForbidden());
    }

    // ---------------------------------------------------------------- 2. 경합

    @Test
    @DisplayName("같은 관계를 동시에 차단해도 둘 다 성공이고 행은 하나다 — ON CONFLICT 가 없으면 한쪽이 500")
    void concurrentBlocksCollapseToOneRow() throws Exception {
        UUID a = newUser();
        UUID b = newUser();

        List<Throwable> failures = runConcurrently(
                () -> userBlockService.block(a, b),
                () -> userBlockService.block(a, b));

        assertThat(failures).as("멱등 insert 라 둘 다 성공해야 한다 — 조회 후 save 면 한쪽은 유니크 위반이다")
                .isEmpty();
        assertThat(countBlocks(a, b)).isEqualTo(1);
    }

    // ---------------------------------------------------------------- 3. 화면 제외

    @Test
    @DisplayName("차단한 친구는 내 목록과 검색에서 빠지고, 해제하면 다시 보인다 — 관계 행은 남는다")
    void blockedFriendDisappearsFromListAndSearchUntilUnblocked() throws Exception {
        UUID a = newUser();
        UUID b = newUser();
        nickname(b, "숨을친구");
        friendService.acceptRequest(b, friendService.createRequest(a, b));

        as(a, get(path(a, "/friends")).param("date", DATE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
        as(a, get(path(a, "/friend-search")).param("type", "NICKNAME").param("q", "숨을친구"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));

        as(a, post(path(a, "/blocks")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"blockedUserId\":\"" + b + "\"}"))
                .andExpect(status().isNoContent());

        as(a, get(path(a, "/friends")).param("date", DATE))
                .andExpect(status().isOk())
                .andExpect(content().json("[]"));
        as(a, get(path(a, "/friend-search")).param("type", "NICKNAME").param("q", "숨을친구"))
                .andExpect(status().isOk())
                .andExpect(content().json("[]"));
        // 제외는 blocker 관점이다 — 차단당한 쪽의 목록·친구 관계는 그대로다.
        as(b, get(path(b, "/friends")).param("date", DATE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));

        as(a, delete(path(a, "/blocks/" + b))).andExpect(status().isNoContent());
        as(a, get(path(a, "/friends")).param("date", DATE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].userId").value(b.toString()));
    }

    // ---------------------------------------------------------------- 도구

    private Integer countBlocks(UUID blocker, UUID blocked) {
        return jdbc.queryForObject(
                "select count(*) from user_blocks where blocker_id = ? and blocked_id = ?",
                Integer.class, blocker, blocked);
    }

    private void nickname(UUID userId, String nickname) {
        jdbc.update("update users set nickname = ? where id = ?", nickname, userId);
    }

    /** 게스트로 만든 뒤 {@code is_guest} 만 내린 회원 — 이 파일이 보는 것은 관계·필터지 승격이 아니다. */
    private UUID newUser() {
        UUID id = jwt.extractUserId(auth.guestLogin().accessToken());
        jdbc.update("update users set is_guest = false where id = ?", id);
        return id;
    }

    private static String path(UUID userId, String rest) {
        return "/internal/users/" + userId + rest;
    }

    private ResultActions as(UUID actor, MockHttpServletRequestBuilder request) throws Exception {
        return mvc.perform(request
                .header("Authorization", "Bearer " + TOKEN)
                .header("X-User-Id", actor.toString()));
    }

    /** 두 작업을 같은 순간에 출발시키고 각자의 실패를 모은다 — 순서는 잠금이 정한다. */
    private static List<Throwable> runConcurrently(Runnable... tasks) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(tasks.length);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<?>> futures = new ArrayList<>();
        for (Runnable task : tasks) {
            futures.add(pool.submit(() -> {
                start.await();
                task.run();
                return null;
            }));
        }
        start.countDown();
        List<Throwable> failures = new ArrayList<>();
        try {
            for (Future<?> future : futures) {
                try {
                    future.get(30, TimeUnit.SECONDS);
                } catch (ExecutionException e) {
                    failures.add(e.getCause());
                }
            }
        } finally {
            pool.shutdownNow();
        }
        return failures;
    }
}
