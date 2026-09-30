package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.friend.service.FriendService;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.internal.dto.LetterSendRequest;
import com.oneorthree.phone.internal.service.InternalLetterService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
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

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
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
    private static final String BLOCKED_PLACEHOLDER = InternalLetterService.BLOCKED_CONTENT_PLACEHOLDER;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.api.enabled", () -> true);
        registry.add("user-blocks.realtime-events-enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        // 배포 yml 의 3줄 + 이 파일이 친구 제외를 증명하려고 여는 2줄.
        // yml 자체와 컨트롤러의 대조는 InternalUserBlockAllowlistTest 가 맡는다.
        registry.add("internal.api.callers.business.allow[0]", () -> "GET /internal/users/*/blocks");
        registry.add("internal.api.callers.business.allow[1]", () -> "POST /internal/users/*/blocks");
        registry.add("internal.api.callers.business.allow[2]", () -> "DELETE /internal/users/*/blocks/*");
        registry.add("internal.api.callers.business.allow[3]", () -> "GET /internal/users/*/friends");
        registry.add("internal.api.callers.business.allow[4]", () -> "GET /internal/users/*/friend-search");
        // GROMO-2179 직접 연락 거절 — 편지 발송·친구 요청·수락.
        registry.add("internal.api.callers.business.allow[5]", () -> "POST /internal/users/*/letters");
        registry.add("internal.api.callers.business.allow[6]", () -> "POST /internal/users/*/friend-requests");
        registry.add("internal.api.callers.business.allow[7]",
                () -> "POST /internal/users/*/friend-requests/*/accept");
        // GROMO-2185 차단한 상대 거르기 — 편지 상세·닫기·편지함, 친구 요청 목록.
        registry.add("internal.api.callers.business.allow[8]", () -> "GET /internal/users/*/letters/*");
        registry.add("internal.api.callers.business.allow[9]", () -> "DELETE /internal/users/*/letters/*");
        registry.add("internal.api.callers.business.allow[10]", () -> "GET /internal/users/*/letters");
        registry.add("internal.api.callers.business.allow[11]", () -> "GET /internal/users/*/friend-requests");
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
    @Autowired
    InternalLetterService letterService;
    @Autowired
    UserRepository userRepository;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;

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

    @Test
    @DisplayName("실제로 관계가 바뀐 차단·해제만 user.blocks.updated 를 REALTIME 으로 적고, 그 version 이 차단 세대다")
    void onlyEffectiveChangesAppendRealtimeBlockEvents() throws Exception {
        UUID a = newUser();
        UUID b = newUser();
        String body = "{\"blockedUserId\":\"" + b + "\"}";

        as(a, post(path(a, "/blocks")).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isNoContent());
        // 이미 있는 관계의 재차단은 세대를 올리지 않는다.
        as(a, post(path(a, "/blocks")).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isNoContent());
        as(a, delete(path(a, "/blocks/" + b))).andExpect(status().isNoContent());
        as(a, delete(path(a, "/blocks/" + b))).andExpect(status().isNoContent());

        List<Map<String, Object>> events = jdbc.queryForList(
                "select version, params->>'changeKind' as kind, params->>'blockerUserId' as blocker,"
                        + " params->>'blockedUserId' as blocked, subject_id, user_id"
                        + " from event_outbox where type = 'user.blocks.updated' and aggregate_type = 'USER_BLOCKS'"
                        + " and aggregate_id = ? order by version", a.toString());
        assertThat(events).extracting(row -> row.get("kind")).containsExactly("BLOCKED", "UNBLOCKED");
        assertThat(events).extracting(row -> ((Number) row.get("version")).longValue()).containsExactly(1L, 2L);
        assertThat(events).allSatisfy(row -> {
            assertThat(row.get("blocker")).isEqualTo(a.toString());
            assertThat(row.get("blocked")).isEqualTo(b.toString());
            assertThat(row.get("subject_id")).isEqualTo(a.toString());
            assertThat(row.get("user_id")).isEqualTo(a);
        });
        assertThat(jdbc.queryForObject("select count(*) from event_outbox_deliveries d join event_outbox o"
                + " on o.id = d.outbox_id where o.type = 'user.blocks.updated' and o.aggregate_id = ?"
                + " and d.target = 'REALTIME'", Integer.class, a.toString())).isEqualTo(2);
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

    // ---------------------------------------------------------------- 4. 직접 연락 거절 (GROMO-2179)

    @Test
    @DisplayName("A 가 B 를 차단하면 친구여도 B→A·A→B 편지 발송이 모두 404 이고 letters 행이 생기지 않는다")
    void lettersAreRejectedBothWaysWhileBlocked() throws Exception {
        UUID a = newUser();
        UUID b = newUser();
        friendService.acceptRequest(b, friendService.createRequest(a, b));
        userBlockService.block(a, b);

        as(b, post(path(b, "/letters")).contentType(MediaType.APPLICATION_JSON)
                .content(letterBody(a)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("LETTER_RECIPIENT_NOT_FRIEND"));
        as(a, post(path(a, "/letters")).contentType(MediaType.APPLICATION_JSON)
                .content(letterBody(b)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("LETTER_RECIPIENT_NOT_FRIEND"));
        assertThat(countLetters(a, b)).as("거절된 발송은 편지 행을 남기지 않는다").isZero();

        // 해제하면 남아 있던 친구 관계로 다시 보낼 수 있다 — 차단이 관계를 지운 것이 아니다(D3).
        userBlockService.unblock(a, b);
        as(b, post(path(b, "/letters")).contentType(MediaType.APPLICATION_JSON)
                .content(letterBody(a)))
                .andExpect(status().isCreated());
    }

    @Test
    @DisplayName("A 가 B 를 차단하면 B→A·A→B 친구 요청 생성이 모두 404 TARGET_USER_NOT_FOUND 이고 행이 없다")
    void friendRequestsAreRejectedBothWaysWhileBlocked() throws Exception {
        UUID a = newUser();
        UUID b = newUser();
        userBlockService.block(a, b);

        as(b, post(path(b, "/friend-requests")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"targetUserId\":\"" + a + "\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("TARGET_USER_NOT_FOUND"));
        as(a, post(path(a, "/friend-requests")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"targetUserId\":\"" + b + "\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("TARGET_USER_NOT_FOUND"));
        assertThat(countFriendships(a, b)).as("거절된 요청은 friendships 행을 남기지 않는다").isZero();

        // 대조 — 해제하면 같은 요청이 통과한다. 위 404 가 대상 부재가 아니라 차단 때문이었다는 증거다.
        userBlockService.unblock(a, b);
        as(b, post(path(b, "/friend-requests")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"targetUserId\":\"" + a + "\"}"))
                .andExpect(status().isCreated());
    }

    @Test
    @DisplayName("서로 차단했으면 한쪽만 해제해도 친구 요청은 여전히 404 다")
    void mutualBlockNeedsBothSidesToUnblock() throws Exception {
        UUID a = newUser();
        UUID b = newUser();
        userBlockService.block(a, b);
        userBlockService.block(b, a);
        userBlockService.unblock(a, b);

        as(a, post(path(a, "/friend-requests")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"targetUserId\":\"" + b + "\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("TARGET_USER_NOT_FOUND"));
    }

    @Test
    @DisplayName("차단 전에 온 대기 요청은 차단 중 어느 쪽이 받은 것이든 수락이 404 이고 PENDING 으로 남는다")
    void pendingRequestsCannotBeAcceptedWhileBlocked() throws Exception {
        UUID a = newUser();
        UUID b = newUser();
        UUID c = newUser();
        UUID fromBlocked = friendService.createRequest(b, a);    // 차단당한 쪽이 보낸 요청을 차단한 쪽이 수락
        UUID toBlocked = friendService.createRequest(a, c);      // 차단한 쪽이 보낸 요청을 차단당한 쪽이 수락
        userBlockService.block(a, b);
        userBlockService.block(a, c);

        as(a, post(path(a, "/friend-requests/" + fromBlocked + "/accept")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("REQUEST_NOT_FOUND"));
        as(c, post(path(c, "/friend-requests/" + toBlocked + "/accept")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("REQUEST_NOT_FOUND"));
        assertThat(friendshipStatus(fromBlocked)).isEqualTo("PENDING");
        assertThat(friendshipStatus(toBlocked)).isEqualTo("PENDING");

        // 대조 — 행을 지우지 않았으므로 해제하면 같은 요청을 수락할 수 있다.
        userBlockService.unblock(a, b);
        as(a, post(path(a, "/friend-requests/" + fromBlocked + "/accept")))
                .andExpect(status().isOk());
        assertThat(friendshipStatus(fromBlocked)).isEqualTo("ACCEPTED");
    }

    // ---------------------------------------------------------------- 5. 차단한 상대 거르기 (GROMO-2185)

    @Test
    @DisplayName("차단한 상대와 주고받은 편지는 상세가 200 이되 본문을 가리고 읽음을 박지 않으며, 해제하면 원문이 보인다")
    void blockedCounterpartLetterDetailMasksContent() throws Exception {
        UUID a = newUser();
        UUID b = newUser();
        friendService.acceptRequest(b, friendService.createRequest(a, b));
        joinIsland(a);
        UUID received = letterService.send(b, new LetterSendRequest(a, "받은 편지")).id();
        UUID sent = letterService.send(a, new LetterSendRequest(b, "보낸 편지")).id();
        userBlockService.block(a, b);

        as(a, get(path(a, "/letters/" + received)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(received.toString()))
                .andExpect(jsonPath("$.content").value(BLOCKED_PLACEHOLDER))
                .andExpect(jsonPath("$.readAt").doesNotExist());
        as(a, get(path(a, "/letters/" + sent)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").value(BLOCKED_PLACEHOLDER));
        assertThat(jdbc.queryForObject("select content from letters where id = ?", String.class, received))
                .as("원문은 DB 에 그대로 남는다").isEqualTo("받은 편지");
        assertThat(jdbc.queryForObject("select read_at is null from letters where id = ?", Boolean.class, received))
                .as("가린 열람은 읽음이 아니다").isTrue();

        userBlockService.unblock(a, b);
        as(a, get(path(a, "/letters/" + received)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").value("받은 편지"));
    }

    @Test
    @DisplayName("차단한 상대의 편지도 수신자가 닫을 수 있다 — 닫기는 소프트 삭제로 끝난다")
    void blockedCounterpartLetterCanBeClosed() throws Exception {
        UUID a = newUser();
        UUID b = newUser();
        friendService.acceptRequest(b, friendService.createRequest(a, b));
        joinIsland(a);
        UUID received = letterService.send(b, new LetterSendRequest(a, "닫을 편지")).id();
        userBlockService.block(a, b);

        as(a, delete(path(a, "/letters/" + received))).andExpect(status().isNoContent());
        assertThat(jdbc.queryForObject("select deleted_at is not null from letters where id = ?",
                Boolean.class, received)).isTrue();
        // 닫힌 편지는 가림과 무관하게 없는 편지다 — 해제해도 되살아나지 않는다.
        userBlockService.unblock(a, b);
        as(a, get(path(a, "/letters/" + received)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("LETTER_NOT_FOUND"));
    }

    @Test
    @DisplayName("보낸 편지함은 차단한 상대가 받은 편지를 빼고, 다른 수신자의 편지는 그대로 둔다")
    void sentMailboxExcludesBlockedReceivers() throws Exception {
        UUID a = newUser();
        UUID b = newUser();
        UUID c = newUser();
        friendService.acceptRequest(b, friendService.createRequest(a, b));
        friendService.acceptRequest(c, friendService.createRequest(a, c));
        letterService.send(a, new LetterSendRequest(b, "차단될 사람에게"));
        UUID toC = letterService.send(a, new LetterSendRequest(c, "남을 편지")).id();
        userBlockService.block(a, b);

        as(a, get(path(a, "/letters")).param("type", "sent"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].id").value(toC.toString()));
    }

    @Test
    @DisplayName("차단한 상대와의 대기 요청은 받은·보낸 요청 목록에서 빠지고, 차단당한 쪽 목록은 그대로다")
    void friendRequestListsExcludeBlockedCounterparts() throws Exception {
        UUID a = newUser();
        UUID b = newUser();
        UUID c = newUser();
        UUID d = newUser();
        friendService.createRequest(b, a);   // 받은 요청 — 차단 대상
        friendService.createRequest(a, c);   // 보낸 요청 — 차단 대상
        friendService.createRequest(d, a);   // 받은 요청 — 차단 안 함
        userBlockService.block(a, b);
        userBlockService.block(a, c);

        as(a, get(path(a, "/friend-requests")).param("type", "received"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].userId").value(d.toString()));
        as(a, get(path(a, "/friend-requests")).param("type", "sent"))
                .andExpect(status().isOk())
                .andExpect(content().json("[]"));
        // 제외는 차단한 쪽 관점이다 — 차단당한 쪽에 따로 알리지 않는다(D3).
        as(b, get(path(b, "/friend-requests")).param("type", "sent"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    @DisplayName("차단한 친구는 핀이 남아 있어도 고정 친구에서 빠지고, 해제하면 다시 보인다")
    void pinnedFriendsExcludeBlocked() {
        UUID a = newUser();
        UUID b = newUser();
        friendService.acceptRequest(b, friendService.createRequest(a, b));
        friendService.pinFriend(a, b);
        LocalDate date = LocalDate.parse(DATE);
        assertThat(friendService.getPinnedFriends(a, date)).hasSize(1);

        userBlockService.block(a, b);
        assertThat(friendService.getPinnedFriends(a, date)).isEmpty();
        assertThat(jdbc.queryForObject("select count(*) from pinned_users where user_id = ? and pinned_user_id = ?",
                Integer.class, a, b)).as("핀 행은 지우지 않는다").isEqualTo(1);

        userBlockService.unblock(a, b);
        assertThat(friendService.getPinnedFriends(a, date)).hasSize(1);
    }

    // ---------------------------------------------------------------- 도구

    /** 살아 있는 섬의 주민으로 만든다 — 편지 상세·닫기의 우체통 게이트가 검사하는 조건이다. */
    private void joinIsland(UUID userId) {
        User user = userRepository.findById(userId).orElseThrow();
        Group island = groups.save(Group.builder().name("차단 섬").maxMembers(10).build());
        members.save(GroupMember.builder().user(user).group(island).build());
    }

    private static String letterBody(UUID receiverId) {
        return "{\"receiverId\":\"" + receiverId + "\",\"content\":\"안녕\"}";
    }

    /** 두 사람 사이의 편지 — 방향·삭제 여부를 가리지 않는다. */
    private Integer countLetters(UUID x, UUID y) {
        return jdbc.queryForObject(
                "select count(*) from letters where (sender_id = ? and receiver_id = ?)"
                        + " or (sender_id = ? and receiver_id = ?)",
                Integer.class, x, y, y, x);
    }

    private Integer countFriendships(UUID x, UUID y) {
        return jdbc.queryForObject(
                "select count(*) from friendships where (from_user_id = ? and to_user_id = ?)"
                        + " or (from_user_id = ? and to_user_id = ?)",
                Integer.class, x, y, y, x);
    }

    private String friendshipStatus(UUID requestId) {
        return jdbc.queryForObject("select status from friendships where id = ?", String.class, requestId);
    }

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
