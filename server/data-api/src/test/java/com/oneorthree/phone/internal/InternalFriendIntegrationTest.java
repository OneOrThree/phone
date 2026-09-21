package com.oneorthree.phone.internal;

import com.jayway.jsonpath.JsonPath;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.friend.event.FriendRequestAcceptedEvent;
import com.oneorthree.phone.friend.exception.FriendErrorCode;
import com.oneorthree.phone.friend.exception.FriendException;
import com.oneorthree.phone.friend.service.FriendService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.context.event.EventListener;
import org.springframework.dao.DataIntegrityViolationException;
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
import java.util.concurrent.CopyOnWriteArrayList;
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
 * 친구 내부 표면 8종 (GROMO-1894 7종 + GROMO-1996 검색)을 <b>실제 Flyway PostgreSQL +
 * InternalAuthFilter</b> 위에서 검증한다.
 *
 * <p>여기서만 확인되는 것: ① V60 의 CHECK 제약이 {@code CANCELED} 를 받는가(create-drop 스키마는 제약이
 * 다르다) ② 허용목록·{@code X-User-Id} 대조가 실제 배선으로 도는가 ③ 동시 요청·동시 수락·취소↔수락
 * 경합이 배타 락으로 닫히는가(한 스레드 안에서 순서를 바꿔 흉내 내면 잠금이 관여하지 않는다)
 * ④ 검색이 실제 {@code lower(nickname)} 축으로 도는가(create-drop 스키마에는 V89 인덱스가 없다).
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(InternalFriendIntegrationTest.AcceptedEvents.class)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class InternalFriendIntegrationTest {

    private static final String TOKEN = "test-friend-business";
    private static final String DATE = "2026-09-18";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        // 배포 yml 의 7줄과 같다 — yml 자체와 컨트롤러의 대조는 InternalFriendAllowlistTest 가 맡는다.
        registry.add("internal.api.callers.business.allow[0]", () -> "GET /internal/users/*/friends");
        registry.add("internal.api.callers.business.allow[1]", () -> "GET /internal/users/*/friend-requests");
        registry.add("internal.api.callers.business.allow[2]", () -> "POST /internal/users/*/friend-requests");
        registry.add("internal.api.callers.business.allow[3]",
                () -> "POST /internal/users/*/friend-requests/*/accept");
        registry.add("internal.api.callers.business.allow[4]",
                () -> "POST /internal/users/*/friend-requests/*/reject");
        registry.add("internal.api.callers.business.allow[5]",
                () -> "POST /internal/users/*/friend-requests/*/cancel");
        registry.add("internal.api.callers.business.allow[6]", () -> "DELETE /internal/users/*/friends/*");
        registry.add("internal.api.callers.business.allow[7]", () -> "GET /internal/users/*/friend-search");
    }

    /** 수락 이벤트를 세는 리스너 — 동시 수락 둘이 알림 이벤트를 «하나만» 내는지 보기 위한 것. */
    static class AcceptedEvents {
        final List<FriendRequestAcceptedEvent> received = new CopyOnWriteArrayList<>();

        @EventListener
        void on(FriendRequestAcceptedEvent event) {
            received.add(event);
        }
    }

    @Autowired
    MockMvc mvc;
    @Autowired
    FriendService friendService;
    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    AcceptedEvents acceptedEvents;

    // ---------------------------------------------------------------- 1. 배선

    @Test
    @DisplayName("요청 → 목록 → 수락 → 친구 목록 → 삭제가 내부 표면으로 한 바퀴 돈다")
    void requestListAcceptAndDeleteFlowThroughInternalSurface() throws Exception {
        UUID a = newUser();
        UUID b = newUser();

        String created = as(a, post(path(a, "/friend-requests")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"targetUserId\":\"" + b + "\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andReturn().getResponse().getContentAsString();
        UUID requestId = UUID.fromString(JsonPath.read(created, "$.requestId"));

        as(b, get(path(b, "/friend-requests")).param("type", "received"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].requestId").value(requestId.toString()))
                .andExpect(jsonPath("$[0].userId").value(a.toString()));
        as(a, get(path(a, "/friend-requests")).param("type", "sent"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].userId").value(b.toString()));

        as(b, post(path(b, "/friend-requests/" + requestId + "/accept")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.requestId").value(requestId.toString()))
                .andExpect(jsonPath("$.status").value("ACCEPTED"));
        as(a, get(path(a, "/friends")).param("date", DATE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].userId").value(b.toString()))
                .andExpect(jsonPath("$[0].isFocusing").value(false));

        // 삭제는 관계 행 자체를 소프트 삭제한다 — 요청 행과 같은 id 가 돌아온다.
        as(b, delete(path(b, "/friends/" + a)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.friendshipId").value(requestId.toString()));
        as(a, get(path(a, "/friends")).param("date", DATE))
                .andExpect(status().isOk())
                .andExpect(content().json("[]"));
    }

    @Test
    @DisplayName("취소는 V60 CHECK 를 통과해 CANCELED 로 남고, 수신자 수락은 409, 재요청은 같은 행을 되살린다")
    void cancelPersistsUnderProductionConstraintAndBlocksLateAccept() throws Exception {
        UUID a = newUser();
        UUID b = newUser();
        UUID requestId = friendService.createRequest(a, b);

        as(a, post(path(a, "/friend-requests/" + requestId + "/cancel")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELED"));
        assertThat(statusOf(requestId)).as("V60 이 없으면 V1 의 CHECK 가 CANCELED 를 거절한다").isEqualTo("CANCELED");

        as(b, post(path(b, "/friend-requests/" + requestId + "/accept")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST_STATUS"));
        assertThat(statusOf(requestId)).isEqualTo("CANCELED");
        as(b, get(path(b, "/friend-requests")).param("type", "received"))
                .andExpect(status().isOk())
                .andExpect(content().json("[]"));

        // 재요청 — unique(from,to) 충돌 없이 취소 행이 PENDING 으로 되살아나고 id 가 같다.
        String again = as(a, post(path(a, "/friend-requests")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"targetUserId\":\"" + b + "\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        assertThat(JsonPath.<String>read(again, "$.requestId")).isEqualTo(requestId.toString());
        assertThat(statusOf(requestId)).isEqualTo("PENDING");
    }

    @Test
    @DisplayName("경로의 유저와 X-User-Id 가 다르면 필터가 403, 역할이 반대면 도메인 403 이다")
    void subjectAndRoleAreEnforced() throws Exception {
        UUID a = newUser();
        UUID b = newUser();
        UUID requestId = friendService.createRequest(a, b);

        mvc.perform(get(path(a, "/friends")).param("date", DATE)
                        .header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", b.toString()))
                .andExpect(status().isForbidden());
        // 허용목록 밖 메서드는 컨트롤러에 닿기 전에 403 이다.
        as(a, put(path(a, "/friends/" + b)))
                .andExpect(status().isForbidden());

        as(b, post(path(b, "/friend-requests/" + requestId + "/cancel")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_REQUEST_SENDER"));
        as(a, post(path(a, "/friend-requests/" + requestId + "/accept")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_REQUEST_RECEIVER"));
        assertThat(statusOf(requestId)).isEqualTo("PENDING");
    }

    // ---------------------------------------------------------------- 2. 경합

    @Test
    @DisplayName("같은 상대에게 동시에 두 번 요청하면 행은 하나만 남고 한쪽은 409 계열로 떨어진다")
    void concurrentDuplicateRequestsLeaveExactlyOneRow() throws Exception {
        UUID a = newUser();
        UUID b = newUser();

        List<Throwable> failures = runConcurrently(
                () -> friendService.createRequest(a, b),
                () -> friendService.createRequest(a, b));

        assertThat(failures).as("둘 다 성공하면 중복 요청·중복 푸시다").hasSize(1);
        assertThat(failures.get(0)).satisfiesAnyOf(
                t -> assertThat(t).isInstanceOf(FriendException.class)
                        .extracting("errorCode").isEqualTo(FriendErrorCode.REQUEST_ALREADY_EXISTS),
                t -> assertThat(t).isInstanceOf(DataIntegrityViolationException.class));
        Integer rows = jdbc.queryForObject(
                "select count(*) from friendships where from_user_id = ? and to_user_id = ?", Integer.class, a, b);
        assertThat(rows).isEqualTo(1);
    }

    @Test
    @DisplayName("같은 요청을 동시에 두 번 수락하면 둘 다 200 이지만 수락 알림 이벤트는 하나다")
    void concurrentAcceptsPublishExactlyOneAcceptedEvent() throws Exception {
        UUID a = newUser();
        UUID b = newUser();
        UUID requestId = friendService.createRequest(a, b);

        List<Throwable> failures = runConcurrently(
                () -> friendService.acceptRequest(b, requestId),
                () -> friendService.acceptRequest(b, requestId));

        assertThat(failures).as("ACCEPTED → ACCEPTED 는 멱등이다").isEmpty();
        assertThat(statusOf(requestId)).isEqualTo("ACCEPTED");
        assertThat(acceptedEvents.received)
                .filteredOn(event -> event.equals(new FriendRequestAcceptedEvent(a, b)))
                .as("배타 락이 빠지면 둘 다 PENDING 을 보고 두 번 알린다")
                .hasSize(1);
    }

    @Test
    @DisplayName("발신자 취소와 수신자 수락이 경합하면 정확히 한쪽만 이긴다 — 취소된 요청이 되살아나지 않는다")
    void cancelAndAcceptRaceLeavesExactlyOneWinner() throws Exception {
        UUID a = newUser();
        UUID b = newUser();
        UUID requestId = friendService.createRequest(a, b);

        List<Throwable> failures = runConcurrently(
                () -> friendService.cancelRequest(a, requestId),
                () -> friendService.acceptRequest(b, requestId));

        String status = statusOf(requestId);
        assertThat(status).isIn("ACCEPTED", "CANCELED");
        // 수락 쪽 CANCELED 가드가 없으면 「취소 → 수락」 순서에서 둘 다 성공해 실패가 0 이 된다.
        assertThat(failures).as("최종 상태 " + status).hasSize(1);
        assertThat(failures.get(0)).isInstanceOf(FriendException.class)
                .extracting("errorCode").isEqualTo(FriendErrorCode.INVALID_REQUEST_STATUS);
    }

    // ---------------------------------------------------------------- 3. 검색 (GROMO-1996)

    /**
     * policy-2026-09-14: 「친구 검색은 대소문자를 구분하지 않고 <b>정확히 일치</b>할 때만 결과를 보여
     * 주며 본인과 탈퇴한 사용자는 제외한다.」 + 비친구에게는 티어·준비 시험을 주지 않는다.
     */
    @Test
    @DisplayName("검색 — 대소문자 무시 전체 일치, 본인·탈퇴자 제외, 비친구는 tier·occupation 이 null")
    void searchMatchesWholeNicknameIgnoringCaseAndHidesNonFriendFields() throws Exception {
        UUID me = newUser();
        UUID other = newUser();
        UUID withdrawn = newUser();
        nickname(me, "Alice");
        nickname(other, "Bob");
        nickname(withdrawn, "Carol");
        jdbc.update("update users set occupation = 'LABOR_ATTORNEY' where id = ?", other);
        jdbc.update("update users set is_deleted = true where id = ?", withdrawn);

        // 대문자로 쳐도 찾힌다.
        as(me, get(path(me, "/friend-search")).param("type", "NICKNAME").param("q", "BOB"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].userId").value(other.toString()))
                .andExpect(jsonPath("$[0].relation").value("NONE"))
                // 비친구다 — 닉네임·id·relation 만 준다.
                .andExpect(jsonPath("$[0].tierLevel").doesNotExist())
                .andExpect(jsonPath("$[0].occupation").doesNotExist());

        // 부분 일치는 안 된다.
        as(me, get(path(me, "/friend-search")).param("type", "NICKNAME").param("q", "Bo"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
        // 본인은 제외한다.
        as(me, get(path(me, "/friend-search")).param("type", "NICKNAME").param("q", "alice"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
        // 탈퇴자는 제외한다.
        as(me, get(path(me, "/friend-search")).param("type", "NICKNAME").param("q", "Carol"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));

        // 친구가 되면 티어·준비 시험이 열린다 — 가리는 축이 relation 이라는 증명이다.
        friendService.acceptRequest(other, friendService.createRequest(me, other));
        as(me, get(path(me, "/friend-search")).param("type", "NICKNAME").param("q", "bob"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].relation").value("FRIEND"))
                .andExpect(jsonPath("$[0].occupation").value("LABOR_ATTORNEY"));
    }

    @Test
    @DisplayName("검색 — 모르는 검색 수단은 도메인 코드로 거절한다 (Spring 변환 실패 400 이 아니다)")
    void searchRejectsUnknownTypeWithDomainCode() throws Exception {
        UUID me = newUser();

        as(me, get(path(me, "/friend-search")).param("type", "EMAIL").param("q", "x"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_SEARCH_TYPE"));
        // 전략이 없는 값(CODE)도 같은 코드로 떨어진다 — enum 에는 있지만 구현체가 없다.
        as(me, get(path(me, "/friend-search")).param("type", "CODE").param("q", "x"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_SEARCH_TYPE"));
        // 소문자 type 은 받아 준다 — 거절할 이유가 없다.
        as(me, get(path(me, "/friend-search")).param("type", "nickname").param("q", "아무도없음"))
                .andExpect(status().isOk());
    }

    // ---------------------------------------------------------------- 도구

    /** 게스트 로그인 계정은 닉네임이 없다 — 검색 대상이 되려면 채워야 한다. */
    private void nickname(UUID userId, String nickname) {
        jdbc.update("update users set nickname = ? where id = ?", nickname, userId);
    }


    private UUID newUser() {
        return jwt.extractUserId(auth.guestLogin().accessToken());
    }

    private static String path(UUID userId, String rest) {
        return "/internal/users/" + userId + rest;
    }

    private ResultActions as(UUID actor, MockHttpServletRequestBuilder request) throws Exception {
        return mvc.perform(request
                .header("Authorization", "Bearer " + TOKEN)
                .header("X-User-Id", actor.toString()));
    }

    private String statusOf(UUID requestId) {
        return jdbc.queryForObject("select status from friendships where id = ?", String.class, requestId);
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
