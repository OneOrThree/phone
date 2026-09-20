package com.oneorthree.phone.internal;

import com.jayway.jsonpath.JsonPath;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.friend.service.FriendService;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.internal.dto.LetterSendRequest;
import com.oneorthree.phone.internal.service.InternalLetterService;
import com.oneorthree.phone.letter.exception.LetterErrorCode;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.BeforeEach;
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
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 편지 내부 표면 4종 (GROMO-1933 발송·목록·상세 + GROMO-2002 닫기)을 <b>실제 Flyway PostgreSQL +
 * InternalAuthFilter</b> 위에서 검증한다.
 *
 * <p>여기서만 확인되는 것: ① V61 의 {@code letters} 스키마(varchar(500)·FK·부분 인덱스)가 실제로
 * 서는가 ② 허용목록·{@code X-User-Id} 대조가 실제 배선으로 도는가 ③ 우체통 게이트가 「받은함·상세만」
 * 걸리는가(보낸함·발송은 열림) ④ 수신자 첫 열람의 원자적 읽음 표시와 «열람만으로는» 삭제되지 않음
 * ⑤ 닫기가 «양쪽»에서 편지를 지우는가 ⑥ 친구 삭제가 아직 확인하지 않은 편지를 지우는가
 * (policy-2026-09-14, GROMO-2002).
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class InternalLetterIntegrationTest {

    private static final String TOKEN = "test-letter-business";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        // 배포 yml 의 3줄과 같다 — yml 자체와 컨트롤러의 대조는 InternalLetterAllowlistTest 가 맡는다.
        registry.add("internal.api.callers.business.allow[0]", () -> "POST /internal/users/*/letters");
        registry.add("internal.api.callers.business.allow[1]", () -> "GET /internal/users/*/letters");
        registry.add("internal.api.callers.business.allow[2]", () -> "GET /internal/users/*/letters/*");
        registry.add("internal.api.callers.business.allow[3]", () -> "DELETE /internal/users/*/letters/*");
    }

    @Autowired
    MockMvc mvc;
    @Autowired
    FriendService friendService;
    @Autowired
    InternalLetterService letterService;
    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    UserRepository users;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;

    /** 컨텍스트·DB 는 클래스 안에서 공유된다 — 편지 행 수를 세는 검증이 앞 테스트의 발송에 오염되지 않게 지운다. */
    @BeforeEach
    void clearLetters() {
        jdbc.update("delete from letters");
    }

    // ---------------------------------------------------------------- 1. 발송

    @Test
    @DisplayName("게스트 발신자도 보낼 수 있고, 수신자에게 우체통·섬이 없어도 발송은 성공한다")
    void guestCanSendAndRecipientMailboxIsNeverLookedUp() throws Exception {
        UUID a = newUser();  // 게스트 — newUser() 는 guestLogin 이다
        UUID b = newUser();  // 섬도 우체통도 없는 수신자
        befriend(a, b);
        assertThat(jdbc.queryForObject("select is_guest from users where id = ?", Boolean.class, a))
                .as("게스트 분기가 있다면 이 테스트는 다른 길을 탄다").isTrue();

        // 발신자 a 도 섬이 없다 — 발송은 어느 쪽의 시설도 묻지 않는다(결정 2 = C).
        as(a, post(path(a, "/letters")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"receiverId\":\"" + b + "\",\"content\":\"  안녕  \"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.senderId").value(a.toString()))
                .andExpect(jsonPath("$.receiverId").value(b.toString()))
                .andExpect(jsonPath("$.content").value("안녕"))   // strip 된 본문이 저장된다
                .andExpect(jsonPath("$.readAt").value(nullValue()));
        assertThat(countLetters()).isEqualTo(1);
    }

    @Test
    @DisplayName("자기 자신·비친구·빈 본문·501자·받는 사람 누락은 각각의 코드로 거절된다")
    void sendRejectsEachBadInputWithItsOwnCode() throws Exception {
        UUID a = newUser();
        UUID b = newUser();
        befriend(a, b);

        as(a, post(path(a, "/letters")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"receiverId\":\"" + a + "\",\"content\":\"x\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("SELF_LETTER"));

        UUID stranger = newUser();  // 친구가 아니다
        as(a, post(path(a, "/letters")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"receiverId\":\"" + stranger + "\",\"content\":\"x\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("LETTER_RECIPIENT_NOT_FRIEND"));

        as(a, post(path(a, "/letters")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"receiverId\":\"" + b + "\",\"content\":\"   \"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("LETTER_CONTENT_BLANK"));

        as(a, post(path(a, "/letters")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"receiverId\":\"" + b + "\",\"content\":\"" + "가".repeat(501) + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("LETTER_CONTENT_OUT_OF_RANGE"));

        // receiverId 누락은 bean validation — 도메인 코드가 아니라 공통 400 이다.
        as(a, post(path(a, "/letters")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":\"x\"}"))
                .andExpect(status().isBadRequest());

        assertThat(countLetters()).as("거절된 발송은 행을 남기지 않는다").isZero();
    }

    // ---------------------------------------------------------------- 2. 열람 게이트

    @Test
    @DisplayName("우체통 없는 호출자는 받은함·상세가 403 이지만 보낸함은 열리고, 잘못된 파라미터는 400 이 먼저다")
    void mailboxGateAppliesOnlyToReceivedListAndDetail() throws Exception {
        UUID a = newUser();
        UUID b = newUser();
        befriend(a, b);
        // a·b 둘 다 섬이 없다. b → a 발송은 게이트 없이 성공한다.
        String sent = as(b, post(path(b, "/letters")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"receiverId\":\"" + a + "\",\"content\":\"x\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        String letterId = JsonPath.read(sent, "$.id");

        as(a, get(path(a, "/letters")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("LETTER_MAILBOX_LOCKED"));
        as(a, get(path(a, "/letters/" + letterId)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("LETTER_MAILBOX_LOCKED"));

        // 보낸함에는 게이트가 없다 — b 는 섬이 없어도 자기가 보낸 편지를 본다.
        as(b, get(path(b, "/letters")).param("type", "sent"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].id").value(letterId))
                .andExpect(jsonPath("$.content[0].isRead").value(false));

        // 파라미터 판정이 게이트보다 먼저다 — 섬이 없어도 잘못된 입력은 400 이다.
        // type 오류는 size 와 코드가 다르다 — Business 가 field=type·field=size 를 구분해 내려야 한다.
        as(a, get(path(a, "/letters")).param("type", "bogus"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_MAILBOX_TYPE"));
        as(a, get(path(a, "/letters")).param("type", " "))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_MAILBOX_TYPE"));
        as(a, get(path(a, "/letters")).param("size", "0"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PAGE_REQUEST"));
        as(a, get(path(a, "/letters")).param("size", "101"))
                .andExpect(status().isBadRequest());
    }

    // ---------------------------------------------------------------- 3. 목록·상세

    @Test
    @DisplayName("수신자의 첫 상세가 읽음을 원자적으로 박고, 다시 읽어도 편지는 삭제되지 않는다")
    void firstDetailMarksReadAtomicallyAndNeverDeletes() throws Exception {
        UUID a = newUser();
        UUID b = newUser();
        befriend(a, b);
        joinIsland(a);
        joinIsland(b);
        String letterId = send(b, a, "읽어줘");

        // 받은함: 상대는 발신자 b 이고 아직 안 읽었다.
        as(a, get(path(a, "/letters")).param("type", "received"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].id").value(letterId))
                .andExpect(jsonPath("$.content[0].counterpartUserId").value(b.toString()))
                .andExpect(jsonPath("$.content[0].isRead").value(false))
                .andExpect(jsonPath("$.hasNext").value(false));

        String first = as(a, get(path(a, "/letters/" + letterId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.senderId").value(b.toString()))
                .andExpect(jsonPath("$.receiverId").value(a.toString()))
                .andExpect(jsonPath("$.readAt").isString())
                .andReturn().getResponse().getContentAsString();
        String readAt = JsonPath.read(first, "$.readAt");

        // 다시 읽어도 행은 남고 최초 열람 시각이 보존된다 — 「읽으면 소멸」 편지가 아니다.
        as(a, get(path(a, "/letters/" + letterId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(letterId))
                .andExpect(jsonPath("$.readAt").value(readAt));
        as(a, get(path(a, "/letters")).param("type", "received"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].isRead").value(true));

        // 발신자가 자기 편지를 다시 봐도 읽음은 바뀌지 않는다 — 「상대가 읽었다」는 신호가 아니다.
        as(b, get(path(b, "/letters/" + letterId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.readAt").value(readAt));

        assertThat(countLetters()).isEqualTo(1);
        assertThat(jdbc.queryForObject("select read_at is not null from letters where id = ?",
                Boolean.class, UUID.fromString(letterId))).isTrue();
    }

    @Test
    @DisplayName("커서는 id 역순 keyset 으로 다음 페이지를 가리킨다")
    void receivedCursorPagesNewestFirst() throws Exception {
        UUID a = newUser();
        UUID b = newUser();
        befriend(a, b);
        joinIsland(a);
        String oldest = send(b, a, "1");
        String middle = send(b, a, "2");
        String newest = send(b, a, "3");

        String page1 = as(a, get(path(a, "/letters")).param("type", "received").param("size", "2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value(2))
                .andExpect(jsonPath("$.hasNext").value(true))
                .andExpect(jsonPath("$.content[0].id").value(newest))
                .andExpect(jsonPath("$.content[1].id").value(middle))
                .andReturn().getResponse().getContentAsString();
        String cursor = JsonPath.read(page1, "$.nextCursor");
        assertThat(cursor).isEqualTo(middle);

        as(a, get(path(a, "/letters")).param("type", "received")
                .param("size", "2").param("cursor", cursor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.hasNext").value(false))
                .andExpect(jsonPath("$.nextCursor").value(nullValue()))
                .andExpect(jsonPath("$.content[0].id").value(oldest))
                .andExpect(jsonPath("$.content.length()").value(1));
    }

    @Test
    @DisplayName("발신자도 수신자도 아닌 유저는 상세를 열지 못하고, 주체 불일치는 필터가 403 으로 막는다")
    void detailRequiresParticipantAndSubjectIsEnforced() throws Exception {
        UUID a = newUser();
        UUID b = newUser();
        befriend(a, b);
        joinIsland(a);
        joinIsland(b);
        String letterId = send(b, a, "비밀");

        UUID outsider = newUser();
        joinIsland(outsider);  // 게이트를 통과하게 해 «참여자 아님» 판정에 도달시킨다.
        as(outsider, get(path(outsider, "/letters/" + letterId)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_LETTER_PARTICIPANT"));

        UUID nobody = UUID.randomUUID();
        as(a, get(path(a, "/letters/" + nobody)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("LETTER_NOT_FOUND"));

        // 경로의 유저와 X-User-Id 가 다르면 컨트롤러에 닿기 전에 필터가 403 이다.
        mvc.perform(get(path(a, "/letters"))
                        .header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", b.toString()))
                .andExpect(status().isForbidden());
    }

    // ---------------------------------------------------------------- 4. 친구 삭제와의 관계

    @Test
    @DisplayName("친구를 삭제하면 아직 «확인하지 않은» 편지가 지워진다 (GROMO-2002, policy-2026-09-14)")
    void friendDeletionRemovesUnreadLetters() throws Exception {
        UUID a = newUser();
        UUID b = newUser();
        befriend(a, b);
        joinIsland(a);
        joinIsland(b);
        String unread = send(b, a, "아직 안 읽음");
        String readAlready = send(b, a, "이미 읽음");
        as(a, get(path(a, "/letters/" + readAlready))).andExpect(status().isOk());   // readAt 이 박힌다

        friendService.deleteFriend(a, b);

        // 행은 남고 deleted_at 만 찍힌다 — 편지는 「주고받은 사실」이라 하드 삭제하지 않는다(V61 FK 논증).
        assertThat(countLetters()).isEqualTo(2);
        assertThat(jdbc.queryForObject("select count(*) from letters where deleted_at is not null",
                Integer.class)).isEqualTo(1);

        // 미확인 편지는 양쪽에서 사라지고, 이미 읽은 편지는 남는다 — 「아직 확인하지 않은」이 정책의 범위다.
        as(a, get(path(a, "/letters/" + unread)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("LETTER_NOT_FOUND"));
        as(b, get(path(b, "/letters/" + unread)))
                .andExpect(status().isNotFound());
        as(a, get(path(a, "/letters/" + readAlready)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").value("이미 읽음"));
        as(a, get(path(a, "/letters")).param("type", "received"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].id").value(readAlready));
    }

    @Test
    @DisplayName("경합 — 친구 삭제와 편지 발송이 동시에 와도 끊긴 관계 위에 미확인 편지가 남지 않는다 (codex 리뷰 P1)")
    void concurrentDeleteAndSendNeverLeaveAnUnreadLetterOnADeletedFriendship() throws Exception {
        // 경합은 확률적이라 한 번으로는 못 잡는다. 관계 행 락이 없으면 이 루프 안에서 「관계는 끊겼는데
        // 살아 있는 미확인 편지가 남은」 상태가 나온다 — 발송이 락 없는 관계 확인을 통과한 뒤 삭제가
        // 정리까지 커밋하고, 그 «다음에» letters 행이 들어가기 때문이다.
        for (int attempt = 0; attempt < 20; attempt++) {
            jdbc.update("delete from letters");
            UUID a = newUser();
            UUID b = newUser();
            befriend(a, b);

            List<Throwable> failures = race(
                    () -> friendService.deleteFriend(a, b),
                    () -> letterService.send(b, new LetterSendRequest(a, "경합")));

            // 삭제는 지지 않는다 — 발송이 먼저 커밋돼도 관계는 끊긴다.
            assertThat(failures).as("삭제까지 실패하면 안 된다").hasSizeLessThan(2);
            assertThat(jdbc.queryForObject(
                    "select deleted_at is not null from friendships where from_user_id = ?", Boolean.class, a))
                    .as("attempt %d — 관계가 끊기지 않았다", attempt).isTrue();

            // 계약(LLD §결정 3 B): 끊긴 관계 위에 «살아 있는 미확인» 편지는 없다. 허용되는 결말은 둘뿐이다.
            assertThat(countAliveUnreadLetters())
                    .as("attempt %d — 관계가 끊긴 뒤 미확인 편지가 살아 남았다", attempt).isZero();
            if (failures.isEmpty()) {
                // ① 발송이 먼저 커밋됐다 — 편지는 꽂혔지만 뒤따른 정리가 소프트 삭제했다.
                assertThat(countLetters()).as("attempt %d", attempt).isEqualTo(1);
            } else {
                // ② 삭제가 먼저 커밋됐다 — 술어 재평가로 발송이 404 에 떨어져 행 자체가 없다.
                assertThat(failures.get(0)).hasFieldOrPropertyWithValue(
                        "errorCode", LetterErrorCode.LETTER_RECIPIENT_NOT_FRIEND);
                assertThat(countLetters()).as("attempt %d", attempt).isZero();
            }
        }
    }

    // ---------------------------------------------------------------- 5. 닫기 (GROMO-2002)

    @Test
    @DisplayName("수신자가 닫으면 «양쪽» 목록·상세에서 사라지고, 다시 닫으면 404 다")
    void closeRemovesLetterFromBothSidesAndIsNotIdempotent() throws Exception {
        UUID sender = newUser();
        UUID receiver = newUser();
        befriend(sender, receiver);
        joinIsland(sender);
        joinIsland(receiver);
        String letterId = send(sender, receiver, "열었다 닫는다");
        as(receiver, get(path(receiver, "/letters/" + letterId))).andExpect(status().isOk());   // 연다

        as(receiver, delete(path(receiver, "/letters/" + letterId)))
                .andExpect(status().isNoContent());

        // 받는 쪽: 목록·상세 모두 사라진다.
        as(receiver, get(path(receiver, "/letters")).param("type", "received"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(0));
        as(receiver, get(path(receiver, "/letters/" + letterId)))
                .andExpect(status().isNotFound());
        // 보내는 쪽에서도 사라진다 — 「보낸 사람 목록에서도 사라진다」(policy-2026-09-14).
        // ⚠ 이 사라짐이 발신자에게 「상대가 읽었다」를 알려 준다. 2026-09-21 재영님이 알고 수용한
        //    누출이다(Letter 엔티티 주석) — 버그로 보고 2컬럼 삭제 모델로 갈아엎기 전에 결정부터 뒤집을 것.
        as(sender, get(path(sender, "/letters")).param("type", "sent"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(0));
        as(sender, get(path(sender, "/letters/" + letterId)))
                .andExpect(status().isNotFound());

        // 재닫기는 안전하다 — 이미 없는 편지라 404 다(멱등 200 이 아니다, FriendService.deleteFriend 선례).
        as(receiver, delete(path(receiver, "/letters/" + letterId)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("LETTER_NOT_FOUND"));
        // 행은 남고 deleted_at 만 찍힌다.
        assertThat(countLetters()).isEqualTo(1);
    }

    @Test
    @DisplayName("닫기는 수신자만 — 발신자는 403, 남의 편지는 403, 열지 않아도 닫을 수 있다")
    void onlyReceiverMayClose() throws Exception {
        UUID sender = newUser();
        UUID receiver = newUser();
        UUID stranger = newUser();
        befriend(sender, receiver);
        joinIsland(sender);
        joinIsland(receiver);
        joinIsland(stranger);
        String letterId = send(sender, receiver, "내 편지");

        as(sender, delete(path(sender, "/letters/" + letterId)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_LETTER_RECEIVER"));
        as(stranger, delete(path(stranger, "/letters/" + letterId)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_LETTER_PARTICIPANT"));
        assertThat(jdbc.queryForObject("select count(*) from letters where deleted_at is not null",
                Integer.class)).isZero();

        // 안 읽은 편지도 닫을 수 있다 — 여는 것과 닫는 것은 다른 사건이라 순서를 강제하지 않는다.
        as(receiver, delete(path(receiver, "/letters/" + letterId)))
                .andExpect(status().isNoContent());
    }

    // ---------------------------------------------------------------- 도구

    private UUID newUser() {
        return jwt.extractUserId(auth.guestLogin().accessToken());
    }

    /** ACCEPTED 친구로 만든다 — 요청 → 수락 두 걸음이 FriendService 의 정상 경로다. */
    private void befriend(UUID a, UUID b) {
        friendService.acceptRequest(b, friendService.createRequest(a, b));
    }

    /** 살아 있는 섬의 주민으로 만든다 — 우체통 게이트가 검사하는 조건 그대로다. */
    private void joinIsland(UUID userId) {
        User user = users.findById(userId).orElseThrow();
        Group island = groups.save(Group.builder().name("우리 섬").maxMembers(10).build());
        members.save(GroupMember.builder().user(user).group(island).build());
    }

    /** 내부 표면으로 편지 한 통을 보내고 그 id 를 돌려준다. */
    private String send(UUID from, UUID to, String content) throws Exception {
        String body = as(from, post(path(from, "/letters")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"receiverId\":\"" + to + "\",\"content\":\"" + content + "\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.id");
    }

    private Integer countLetters() {
        return jdbc.queryForObject("select count(*) from letters", Integer.class);
    }

    /** 「아직 확인하지 않은」 채로 살아 있는 편지 — 친구 삭제 계약이 0 으로 만들어야 하는 수다. */
    private Integer countAliveUnreadLetters() {
        return jdbc.queryForObject(
                "select count(*) from letters where deleted_at is null and read_at is null", Integer.class);
    }

    /** 두 명령을 동시에 출발시키고 실패만 모은다 ({@code IslandManagementIntegrationTest} 와 같은 판). */
    private List<Throwable> race(Callable<?> left, Callable<?> right) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<?>> futures = new ArrayList<>();
            for (Callable<?> task : List.of(left, right)) {
                futures.add(pool.submit(() -> {
                    start.await();
                    return task.call();
                }));
            }
            start.countDown();
            List<Throwable> failures = new ArrayList<>();
            for (Future<?> future : futures) {
                try {
                    future.get(30, TimeUnit.SECONDS);
                } catch (ExecutionException e) {
                    failures.add(e.getCause());
                }
            }
            return failures;
        } finally {
            pool.shutdownNow();
        }
    }

    private static String path(UUID userId, String rest) {
        return "/internal/users/" + userId + rest;
    }

    private ResultActions as(UUID actor, MockHttpServletRequestBuilder request) throws Exception {
        return mvc.perform(request
                .header("Authorization", "Bearer " + TOKEN)
                .header("X-User-Id", actor.toString()));
    }
}
