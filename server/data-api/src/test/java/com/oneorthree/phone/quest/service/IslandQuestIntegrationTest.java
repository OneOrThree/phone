package com.oneorthree.phone.quest.service;

import com.oneorthree.phone.construction.repository.IslandFacilityRepository;
import com.oneorthree.phone.construction.repository.domain.IslandFacility;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.domain.FocusIntervalKind;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.focus.repository.domain.FocusType;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.IslandJoinRequestRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.IslandJoinRequest;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.quest.dto.QuestViews;
import com.oneorthree.phone.quest.exception.QuestErrorCode;
import com.oneorthree.phone.quest.exception.QuestException;
import com.oneorthree.phone.quest.repository.IslandQuestRepository;
import com.oneorthree.phone.quest.repository.domain.IslandQuest;
import com.oneorthree.phone.quest.repository.domain.QuestType;
import com.oneorthree.phone.quest.scheduler.IslandQuestScheduler;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

/**
 * 섬 퀘스트 5계약의 Data 통합 검증 (GROMO-1773) — 실 Flyway(V71 포함) 스키마 위에서 운영 엔티티·저장소로
 * 섬·주민·게시판·집중 구간·스크린타임을 심고, 서비스·스케줄러의 실제 경로로 회차를 열고 정산한다.
 *
 * <p>시각은 서버 {@link Clock} 빈을 제어해 UTC 경계를 재현한다(DelayedDomainEligibilityIntegrationTest 와 같은
 * 방식). 집중 시작 게이트가 main 에서 닫혀 있어 세션은 start 명령이 쓰는 것과 같은 행(마커·상세·구간)을
 * 직접 심는다(IslandFocusMembersIntegrationTest 와 같은 방식).
 */
@SpringBootTest
class IslandQuestIntegrationTest {

    /** UTC 회차 날짜 D. */
    private static final LocalDate D = LocalDate.of(2031, 3, 10);
    private static final AtomicReference<Instant> NOW = new AtomicReference<>();

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("island-quest.creation-enabled", () -> true);
        registry.add("island-quest.settlement-enabled", () -> true);
    }

    @MockitoBean
    Clock clock;

    @Autowired
    IslandQuestService service;
    @Autowired
    IslandQuestScheduler scheduler;
    @Autowired
    IslandQuestRepository quests;
    @Autowired
    UserRepository users;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    IslandJoinRequestRepository joinRequests;
    @Autowired
    IslandFacilityRepository facilities;
    @Autowired
    FocusSessionRepository sessions;
    @Autowired
    FocusSessionDetailRepository details;
    @Autowired
    FocusSessionIntervalRepository intervals;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    ObjectMapper mapper;

    @BeforeEach
    void controlClock() {
        when(clock.instant()).thenAnswer(invocation -> NOW.get());
        when(clock.getZone()).thenReturn(ZoneOffset.UTC);
        at(D, "10:00:00");
    }

    // ---------------------------------------------------------------- 권한

    @Test
    @DisplayName("생성·수정은 방장만 — 주민은 403 QUEST_FORBIDDEN, 게시판 없으면 조회도 403")
    void createAndUpdateAreOwnerOnly() {
        Island a = island(true);
        User resident = resident(a.group);

        assertQuestError(() -> createFocus(a, resident, "18:00", "23:00", 30), QuestErrorCode.QUEST_FORBIDDEN);

        UUID questId = createFocus(a, a.owner, "18:00", "23:00", 30).id();
        assertQuestError(() -> service.update(a.id, resident.getId(), questId, "바꿈", null, UUID.randomUUID()),
                QuestErrorCode.QUEST_FORBIDDEN);
        // 주민 조회는 된다.
        assertThat(service.current(a.id, resident.getId()).items()).hasSize(1);

        Island noBoard = island(false);
        assertQuestError(() -> service.current(noBoard.id, noBoard.owner.getId()),
                QuestErrorCode.QUEST_BOARD_LOCKED);
    }

    @Test
    @DisplayName("방문자·가입 대기자는 퀘스트와 주민별 달성률을 읽고(myRate null), 생성·수정·정산은 MEMBER_ONLY 다")
    void visitorsReadQuestsButCannotWrite() {
        Island a = island(true);
        User resident = resident(a.group);
        QuestViews.Created created = createFocus(a, a.owner, "10:00", "12:00", 30);
        UUID occurrenceId = occurrenceOf(created);
        User visitor = users.save(User.builder().nickname("밖-" + UUID.randomUUID()).build());
        User applicant = users.save(User.builder().nickname("신청-" + UUID.randomUUID()).build());
        joinRequests.save(IslandJoinRequest.pending(a.group, applicant, null));

        for (User reader : List.of(visitor, applicant)) {
            QuestViews.Item item = service.current(a.id, reader.getId()).items().get(0);
            assertThat(item.occurrenceId()).isEqualTo(occurrenceId);
            assertThat(item.myRate()).as("방문자는 cohort 밖").isNull();
            QuestViews.Progress progress = service.progress(a.id, reader.getId(), created.id(), occurrenceId);
            assertThat(progress.members()).extracting(QuestViews.Member::userId)
                    .containsExactlyInAnyOrder(a.owner.getId(), resident.getId());

            UUID id = reader.getId();
            for (ThrowingCallable write : List.<ThrowingCallable>of(
                    () -> service.create(a.id, id, "몰래", "focus", 30, "18:00", "23:00", null, UUID.randomUUID()),
                    () -> service.update(a.id, id, created.id(), "몰래", null, UUID.randomUUID()),
                    () -> service.claim(a.id, id, created.id(), occurrenceId, 1, UUID.randomUUID()))) {
                assertThatThrownBy(write).isInstanceOfSatisfying(GroupException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.MEMBER_ONLY));
            }
        }

        // 방문자도 미완공 게시판은 403, 종료된 섬은 404 다.
        Island noBoard = island(false);
        assertQuestError(() -> service.current(noBoard.id, visitor.getId()), QuestErrorCode.QUEST_BOARD_LOCKED);
        jdbc.update("UPDATE groups SET status = 'ENDED' WHERE id = ?", a.id);
        assertThatThrownBy(() -> service.current(a.id, visitor.getId()))
                .isInstanceOfSatisfying(GroupException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.GROUP_NOT_FOUND));
    }

    @Test
    @DisplayName("입력 범위 — 자정 넘는 창 422, 창보다 긴 목표 422, UTC 외 시간대 400, 빈 이름 422")
    void rejectsOutOfRangeDefinitions() {
        Island a = island(true);

        assertQuestError(() -> createFocus(a, a.owner, "23:00", "01:00", 30),
                QuestErrorCode.QUEST_WINDOW_OUT_OF_RANGE);
        assertQuestError(() -> createFocus(a, a.owner, "18:00", "18:20", 30),
                QuestErrorCode.QUEST_TARGET_OUT_OF_RANGE);
        assertQuestError(() -> service.create(a.id, a.owner.getId(), "저녁", "focus", 30, "18:00", "23:00",
                "Asia/Seoul", UUID.randomUUID()), QuestErrorCode.QUEST_INVALID_TIMEZONE);
        assertQuestError(() -> service.create(a.id, a.owner.getId(), " ", "focus", 30, "18:00", "23:00",
                "UTC", UUID.randomUUID()), QuestErrorCode.QUEST_TITLE_OUT_OF_RANGE);
    }

    // ---------------------------------------------------------------- 회차

    @Test
    @DisplayName("PATCH 는 열린 회차를 바꾸지 않고 다음 UTC 회차부터 적용된다")
    void patchAppliesFromNextOccurrenceOnly() {
        Island a = island(true);
        UUID questId = createFocus(a, a.owner, "18:00", "23:00", 30).id();

        QuestViews.Updated updated = service.update(a.id, a.owner.getId(), questId, "저녁 40분 집중", 40,
                UUID.randomUUID());
        assertThat(updated.title()).isEqualTo("저녁 40분 집중");
        assertThat(updated.targetMinutes()).isEqualTo(40);

        QuestViews.Item today = service.current(a.id, a.owner.getId()).items().get(0);
        assertThat(today.date()).isEqualTo(D.toString());
        assertThat(today.targetMinutes()).as("진행 중 회차는 생성 때 스냅샷").isEqualTo(30);
        assertThat(today.title()).isEqualTo("저녁 30분");
        assertThat(today.timezone()).isEqualTo("UTC");
        assertThat(today.windowStart()).isEqualTo("18:00");

        // UTC 자정을 넘기면 스케줄러가 새 정의로 D+1 회차를 연다. D 회차는 다음 날 12:00 까지 현재다.
        at(D.plusDays(1), "00:00:30");
        scheduler.openDueOccurrences();
        scheduler.openDueOccurrences();

        assertThat(service.current(a.id, a.owner.getId()).items())
                .extracting(QuestViews.Item::date, QuestViews.Item::targetMinutes, QuestViews.Item::title)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(D.toString(), 30, "저녁 30분"),
                        org.assertj.core.groups.Tuple.tuple(D.plusDays(1).toString(), 40, "저녁 40분 집중"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM island_quest_occurrences WHERE quest_id = ?",
                Integer.class, questId)).as("같은 날 두 번 돌려도 회차는 하나").isEqualTo(2);
    }

    @Test
    @DisplayName("작성자가 계정 탈퇴로 끊긴 퀘스트(created_by null)도 다음 UTC 회차가 시스템 주체로 열린다")
    void occurrenceOpensWhenCreatorWasErased() {
        Island a = island(true);
        UUID questId = createFocus(a, a.owner, "18:00", "23:00", 30).id();
        // 탈퇴 파기(IslandQuestRepository#detachCreator)와 같은 결과
        jdbc.update("UPDATE island_quests SET created_by = NULL WHERE id = ?", questId);

        at(D.plusDays(1), "00:00:30");
        scheduler.openDueOccurrences();

        QuestViews.Item next = service.current(a.id, a.owner.getId()).items().get(1);
        assertThat(next.id()).isEqualTo(questId);
        assertThat(next.date()).isEqualTo(D.plusDays(1).toString());
        assertThat(jdbc.queryForObject("SELECT user_id FROM event_outbox WHERE aggregate_type = ? AND aggregate_id = ?",
                UUID.class, IslandQuestEvents.AGGREGATE_TYPE, next.occurrenceId().toString()))
                .isEqualTo(IslandQuestService.SYSTEM_ACTOR);
    }

    @Test
    @DisplayName("cohort 는 회차 시작 때 고정 — 뒤늦은 가입자는 빠지고, 떠난 주민은 분모에서 제거된다")
    void cohortIsFixedAtOccurrenceStart() {
        Island a = island(true);
        User stays = resident(a.group);
        User leaves = resident(a.group);
        QuestViews.Created created = createFocus(a, a.owner, "00:00", "23:00", 1);
        User late = resident(a.group);
        leave(leaves, a.group);

        QuestViews.Progress progress = service.progress(a.id, a.owner.getId(), created.id(), occurrenceOf(created));
        assertThat(progress.members()).extracting(QuestViews.Member::userId)
                .containsExactlyInAnyOrder(a.owner.getId(), stays.getId());
        assertThat(progress.header().reward().amount()).as("내 개인 몫").isEqualTo(10);
        assertThat(progress.header().bonusAmount()).as("전원 달성 보너스 = 분모 2명 × 5").isEqualTo(10);

        // 공개 계약은 헤더 필드가 평평하게 펼쳐진 모양이다(원본 quest 예시).
        JsonNode json = mapper.valueToTree(progress);
        assertThat(json.has("header")).isFalse();
        assertThat(json.get("occurrenceId").asString()).isEqualTo(occurrenceOf(created).toString());
        assertThat(json.get("members").size()).isEqualTo(2);
        assertThat(json.has("nextCursor")).isTrue();

        // 뒤늦은 가입자는 조회는 되지만 판정 대상이 아니라 myRate 가 없다.
        assertThat(service.current(a.id, late.getId()).items().get(0).myRate()).isNull();
    }

    @Test
    @DisplayName("집중은 ACTIVE 만 창(UTC)에 잘라 정확한 초로 비교한다 — REST 제외, 1초 모자라면 미달성")
    void focusProgressIsExactSecondsClippedToWindow() {
        Island a = island(true);
        User shortBySecond = resident(a.group);
        User exact = resident(a.group);
        at(D, "00:00:10");
        QuestViews.Created created = createFocus(a, a.owner, "00:00", "01:00", 30);

        // 20분(전날 23:50 부터지만 창은 00:00 부터) + REST 10분(0초) + 9분 59초 = 1799초.
        UUID s1 = session(shortBySecond, a.id, FocusSessionLifecycle.COMPLETED);
        interval(s1, 1, FocusIntervalKind.ACTIVE, at(D.minusDays(1), "23:50:00"), at(D, "00:20:00"));
        interval(s1, 2, FocusIntervalKind.REST, at(D, "00:20:00"), at(D, "00:30:00"));
        interval(s1, 3, FocusIntervalKind.ACTIVE, at(D, "00:30:00"), at(D, "00:39:59"));
        // 20분 + 창 끝(01:00)에서 잘린 10분 = 정확히 1800초.
        UUID s2 = session(exact, a.id, FocusSessionLifecycle.COMPLETED);
        interval(s2, 1, FocusIntervalKind.ACTIVE, at(D, "00:00:00"), at(D, "00:20:00"));
        interval(s2, 2, FocusIntervalKind.ACTIVE, at(D, "00:50:00"), at(D, "01:20:00"));
        // 다른 섬에 귀속된 집중은 세지 않는다.
        Island other = island(true);
        UUID s3 = session(a.owner, other.id, FocusSessionLifecycle.COMPLETED);
        interval(s3, 1, FocusIntervalKind.ACTIVE, at(D, "00:00:00"), at(D, "00:59:00"));

        at(D, "02:00:00");
        QuestViews.Progress progress = service.progress(a.id, a.owner.getId(), created.id(), occurrenceOf(created));

        assertThat(member(progress, shortBySecond).rate()).isEqualTo(99);
        assertThat(member(progress, exact).rate()).isEqualTo(100);
        assertThat(member(progress, a.owner).rate()).isZero();
        assertThat(member(progress, exact).measurementStatus()).isEqualTo("authorized");
        assertThat(progress.header().claimable()).as("방장은 0초라 미달성").isFalse();
        assertThat(progress.header().claimBlockedReason()).isEqualTo("NOT_ACHIEVED");
        assertThat(member(progress, exact).achieved()).as("달성은 rate 100 과 별개 필드다").isTrue();
        assertThat(member(progress, shortBySecond).achieved()).isFalse();
        assertThat(progress.nextCursor()).isNull();
    }

    @Test
    @DisplayName("screen 퀘스트는 1930(스크린타임 날짜 축 UTC 전환) 전까지 생성·수정 모두 422 다")
    void screenQuestsAreRejectedUntilScreenTimeIsUtc() {
        Island a = island(true);

        assertQuestError(() -> service.create(a.id, a.owner.getId(), "폰 1시간 이하", "screen", 60, null, null, null,
                UUID.randomUUID()), QuestErrorCode.QUEST_TYPE_OUT_OF_RANGE);
        assertQuestError(() -> service.create(a.id, a.owner.getId(), "폰 1시간 이하", "screen", 60, "18:00", null,
                "UTC", UUID.randomUUID()), QuestErrorCode.QUEST_TYPE_OUT_OF_RANGE);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM island_quests WHERE island_id = ?", Integer.class, a.id))
                .isZero();

        // 스위치 이전 데이터 등으로 screen 정의가 이미 있어도 수정은 받지 않는다.
        IslandQuest legacy = quests.save(IslandQuest.builder().islandId(a.id).type(QuestType.SCREEN)
                .title("폰 1시간 이하").targetMinutes(60).createdBy(a.owner.getId()).build());
        assertQuestError(() -> service.update(a.id, a.owner.getId(), legacy.getId(), null, 30, UUID.randomUUID()),
                QuestErrorCode.QUEST_TYPE_OUT_OF_RANGE);
    }

    // ---------------------------------------------------------------- 정산

    @Test
    @DisplayName("달성한 주민만 자기 몫 10 을 받는다 — 미달성자는 409, 같은 사람의 재수령도 409, 같은 키는 재생")
    void achieverClaimsOwnShareOnly() {
        Island a = island(true);
        User resident = resident(a.group);
        QuestViews.Created created = createFocus(a, a.owner, "10:00", "12:00", 30);
        UUID occurrenceId = occurrenceOf(created);
        UUID ownerSession = session(a.owner, a.id, FocusSessionLifecycle.COMPLETED);
        interval(ownerSession, 1, FocusIntervalKind.ACTIVE, at(D, "10:00:00"), at(D, "10:30:00"));

        at(D, "10:40:00");
        // 남이 달성했든 말든 미달성자는 받을 수 없다 — 대리 수령 경로가 없다.
        assertQuestError(() -> service.claim(a.id, resident.getId(), created.id(), occurrenceId, 1,
                UUID.randomUUID()), QuestErrorCode.QUEST_STATE_CONFLICT);
        assertThat(balance(a.id)).isZero();
        assertThat(service.current(a.id, resident.getId()).items().get(0).claimBlockedReason())
                .isEqualTo("NOT_ACHIEVED");

        QuestViews.Item mine = service.current(a.id, a.owner.getId()).items().get(0);
        assertThat(mine.claimable()).isTrue();
        assertThat(mine.claimBlockedReason()).isNull();
        assertThat(mine.reward().amount()).as("개인 몫").isEqualTo(10);
        assertThat(mine.bonusGranted()).isFalse();

        assertQuestError(() -> service.claim(a.id, a.owner.getId(), created.id(), occurrenceId,
                mine.version() + 1, UUID.randomUUID()), QuestErrorCode.QUEST_VERSION_CONFLICT);

        UUID key = UUID.randomUUID();
        QuestViews.Claimed first = service.claim(a.id, a.owner.getId(), created.id(), occurrenceId,
                mine.version(), key);
        assertThat(first.claimed()).isTrue();
        assertThat(first.occurrenceId()).isEqualTo(occurrenceId);
        assertThat(first.villagePointsAdded()).isEqualTo(10);
        assertThat(first.bonusAdded()).as("전원 달성이 아니라 보너스는 없다").isZero();
        assertThat(balance(a.id)).isEqualTo(10);

        assertThat(service.claim(a.id, a.owner.getId(), created.id(), occurrenceId, mine.version(), key))
                .as("같은 키는 원 결과 재생").isEqualTo(first);
        assertQuestError(() -> service.claim(a.id, a.owner.getId(), created.id(), occurrenceId,
                mine.version() + 1, UUID.randomUUID()), QuestErrorCode.QUEST_STATE_CONFLICT);
        assertThatThrownBy(() -> service.claim(a.id, a.owner.getId(), created.id(), occurrenceId,
                mine.version() + 1, key))
                .as("같은 키 다른 본문은 재사용 거절")
                .isInstanceOfSatisfying(OutboxException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(OutboxErrorCode.IDEMPOTENCY_KEY_CONFLICT));

        assertThat(balance(a.id)).as("두 번 눌러도 한 번만 적립").isEqualTo(10);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM island_wallet_transactions WHERE island_id = ? "
                + "AND type = 'QUEST_SETTLEMENT'", Integer.class, a.id)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM island_construction_contributions WHERE island_id = ?",
                Integer.class, a.id)).as("퀘스트 적립은 건설 「각자 몫」에 쌓지 않는다").isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM island_quest_claims WHERE occurrence_id = ?",
                Integer.class, occurrenceId)).isEqualTo(1);

        QuestViews.Progress after = service.progress(a.id, resident.getId(), created.id(), occurrenceId);
        assertThat(member(after, a.owner).claimed()).isTrue();
        assertThat(member(after, resident).claimed()).isFalse();
        assertThat(after.header().claimed()).as("헤더의 수령 축은 조회한 주민이다").isFalse();
        assertThat(after.header().bonusGranted()).isFalse();
        QuestViews.Item settled = service.current(a.id, a.owner.getId()).items().get(0);
        assertThat(settled.claimed()).isTrue();
        assertThat(settled.settlementStatus()).isEqualTo("claimed");
        assertThat(settled.claimable()).isFalse();
        assertThat(settled.version()).as("수령이 quest.progress version 을 올린다").isEqualTo(mine.version() + 1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM event_outbox WHERE type = 'quest.progress.updated' "
                + "AND aggregate_id = ?", Integer.class, occurrenceId.toString())).isEqualTo(2);
    }

    @Test
    @DisplayName("전원 달성이면 보너스 «분모 × 5» 가 수령 없이 한 번 적립된다 — 나머지 주민은 자기 몫만 더 받는다")
    void allAchievedGrantsBonusOnce() {
        Island a = island(true);
        User resident = resident(a.group);
        QuestViews.Created created = createFocus(a, a.owner, "10:00", "12:00", 30);
        UUID occurrenceId = occurrenceOf(created);
        for (User achiever : List.of(a.owner, resident)) {
            UUID focus = session(achiever, a.id, FocusSessionLifecycle.COMPLETED);
            interval(focus, 1, FocusIntervalKind.ACTIVE, at(D, "10:00:00"), at(D, "10:30:00"));
        }

        at(D, "10:40:00");
        QuestViews.Item before = service.current(a.id, a.owner.getId()).items().get(0);
        assertThat(before.bonusAmount()).as("분모 2명 × 5").isEqualTo(10);
        assertThat(before.bonusGranted()).isFalse();

        QuestViews.Claimed first = service.claim(a.id, a.owner.getId(), created.id(), occurrenceId,
                before.version(), UUID.randomUUID());
        assertThat(first.villagePointsAdded()).isEqualTo(10);
        assertThat(first.bonusAdded()).as("전원 달성 보너스는 수령 TX 에서 자동 적립").isEqualTo(10);
        assertThat(balance(a.id)).isEqualTo(20);

        QuestViews.Item mid = service.current(a.id, resident.getId()).items().get(0);
        assertThat(mid.bonusGranted()).isTrue();
        assertThat(mid.claimable()).as("보너스가 나갔어도 내 몫은 아직이다").isTrue();

        QuestViews.Claimed second = service.claim(a.id, resident.getId(), created.id(), occurrenceId,
                mid.version(), UUID.randomUUID());
        assertThat(second.villagePointsAdded()).isEqualTo(10);
        assertThat(second.bonusAdded()).as("보너스는 회차당 한 번뿐").isZero();

        assertThat(balance(a.id)).as("개인 10 × 2 + 보너스 2 × 5").isEqualTo(30);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM island_quest_claims WHERE occurrence_id = ? "
                + "AND kind = 'ALL_ACHIEVED_BONUS'", Integer.class, occurrenceId)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM island_quest_claims WHERE occurrence_id = ?",
                Integer.class, occurrenceId)).as("개인 2 + 보너스 1").isEqualTo(3);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM island_wallet_transactions WHERE island_id = ? "
                + "AND type = 'QUEST_SETTLEMENT'", Integer.class, a.id)).isEqualTo(3);
        assertThat(jdbc.queryForObject("SELECT bonus_settled_at IS NOT NULL FROM island_quest_occurrences "
                + "WHERE id = ?", Boolean.class, occurrenceId)).isTrue();

        QuestViews.Item done = service.current(a.id, resident.getId()).items().get(0);
        assertThat(done.claimed()).isTrue();
        assertThat(done.claimable()).isFalse();
        assertThat(done.bonusAmount()).as("적립 뒤엔 실제 적립량").isEqualTo(10);
        assertThat(done.version()).isEqualTo(before.version() + 2);
    }

    @Test
    @DisplayName("아무도 받기를 누르지 않아도 전원 달성 보너스는 finalizer 틱이 한 번 적립한다 (GROMO-1991)")
    void bonusSettlesWithoutAnyClaim() {
        Island a = island(true);
        User resident = resident(a.group);
        QuestViews.Created created = createFocus(a, a.owner, "10:00", "12:00", 30);
        UUID occurrenceId = occurrenceOf(created);
        UUID ownerFocus = session(a.owner, a.id, FocusSessionLifecycle.COMPLETED);
        interval(ownerFocus, 1, FocusIntervalKind.ACTIVE, at(D, "10:00:00"), at(D, "10:30:00"));

        // 한 명만 달성 — 틱이 돌아도 보너스는 없다(부분 달성 적립 0).
        at(D, "10:35:00");
        scheduler.settleDueBonuses();
        assertThat(balance(a.id)).as("부분 달성은 보너스 없음").isZero();
        assertThat(service.current(a.id, a.owner.getId()).items().get(0).bonusGranted()).isFalse();

        UUID residentFocus = session(resident, a.id, FocusSessionLifecycle.COMPLETED);
        interval(residentFocus, 1, FocusIntervalKind.ACTIVE, at(D, "10:00:00"), at(D, "10:30:00"));

        at(D, "10:40:00");
        scheduler.settleDueBonuses();

        QuestViews.Item item = service.current(a.id, a.owner.getId()).items().get(0);
        assertThat(item.bonusGranted()).as("수령이 없어도 적립된다 — 보너스는 claim 과 독립이다").isTrue();
        assertThat(item.bonusAmount()).as("분모 2명 × 5").isEqualTo(10);
        assertThat(item.claimed()).as("개인 몫은 아직 아무도 안 받았다").isFalse();
        assertThat(item.claimable()).isTrue();
        assertThat(balance(a.id)).as("보너스만 나갔다").isEqualTo(10);

        scheduler.settleDueBonuses();
        assertThat(balance(a.id)).as("틱을 다시 돌려도 회차당 한 번뿐").isEqualTo(10);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM island_quest_claims WHERE occurrence_id = ? "
                + "AND kind = 'ALL_ACHIEVED_BONUS'", Integer.class, occurrenceId)).isEqualTo(1);

        QuestViews.Claimed claimed = service.claim(a.id, a.owner.getId(), created.id(), occurrenceId,
                item.version(), UUID.randomUUID());
        assertThat(claimed.villagePointsAdded()).as("보너스가 나간 뒤에도 개인 몫은 각자 받는다").isEqualTo(10);
        assertThat(claimed.bonusAdded()).as("이미 적립된 보너스를 두 번 주지 않는다").isZero();
        assertThat(balance(a.id)).isEqualTo(20);
    }

    @Test
    @DisplayName("마지막 틱 뒤·마감 전에 분모가 줄어 성립한 전원 달성은 마감 다음 틱이 적립한다 (codex 2R)")
    void bonusSettlesOnTheTickAfterDeadlineWhenDenominatorShrankBeforeIt() {
        Island a = island(true);
        User resident = resident(a.group);
        QuestViews.Created created = createFocus(a, a.owner, "10:00", "12:00", 30);
        UUID occurrenceId = occurrenceOf(created);
        UUID ownerFocus = session(a.owner, a.id, FocusSessionLifecycle.COMPLETED);
        interval(ownerFocus, 1, FocusIntervalKind.ACTIVE, at(D, "10:00:00"), at(D, "10:30:00"));

        // 수령 마감(다음 날 12:00Z) 직전의 «마지막» 틱 — 주민이 미달성이라 보너스는 없다.
        at(D.plusDays(1), "11:59:30");
        scheduler.settleDueBonuses();
        assertThat(balance(a.id)).as("부분 달성은 보너스 없음").isZero();

        // 그 틱과 마감 사이(15초)에 미달성 주민이 분모에서 빠져 전원 달성이 «마감 전에» 성립한다.
        // 이 판정을 볼 틱은 마감 뒤 첫 틱뿐이다 — 예전에는 거기서 0 을 돌려주고 보너스가 영구 누락됐다.
        at(D.plusDays(1), "11:59:45");
        leave(resident, a.group);

        at(D.plusDays(1), "12:00:30");
        scheduler.settleDueBonuses();

        assertThat(balance(a.id)).as("마감 전에 성립한 달성은 늦게 발견돼도 지급된다 — 분모 1명 × 5").isEqualTo(5);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM island_quest_claims WHERE occurrence_id = ? "
                + "AND kind = 'ALL_ACHIEVED_BONUS'", Integer.class, occurrenceId)).isEqualTo(1);

        scheduler.settleDueBonuses();
        assertThat(balance(a.id)).as("마감 뒤 틱을 또 돌려도 회차당 한 번뿐").isEqualTo(5);
    }

    @Test
    @DisplayName("정산 마감(수령 마감 + 한 틱)을 넘겨 «새로» 성립한 전원 달성엔 보너스가 없다 (codex 2R)")
    void bonusIsNotGrantedWhenAllAchievedOnlyAfterTheSettleDeadline() {
        Island a = island(true);
        User resident = resident(a.group);
        QuestViews.Created created = createFocus(a, a.owner, "10:00", "12:00", 30);
        UUID occurrenceId = occurrenceOf(created);
        UUID ownerFocus = session(a.owner, a.id, FocusSessionLifecycle.COMPLETED);
        interval(ownerFocus, 1, FocusIntervalKind.ACTIVE, at(D, "10:00:00"), at(D, "10:30:00"));

        // 수령 마감(12:00Z)도 정산 마감(12:01Z)도 지난 뒤에 미달성 주민이 빠진다.
        at(D.plusDays(1), "12:05:00");
        leave(resident, a.group);
        scheduler.settleDueBonuses();

        assertThat(balance(a.id)).as("마감 뒤에 새로 생긴 달성으로 보너스가 생기지 않는다").isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM island_quest_claims WHERE occurrence_id = ?",
                Integer.class, occurrenceId)).isZero();
    }

    @Test
    @DisplayName("다음 날 12:00 UTC 가 지난 focus 회차는 현재가 아니다 — 조회 404, 수령 409")
    void pastFocusOccurrenceIsClosed() {
        Island a = island(true);
        QuestViews.Created created = createFocus(a, a.owner, "10:00", "12:00", 30);
        UUID occurrenceId = occurrenceOf(created);

        at(D.plusDays(1), "12:00:00");
        assertQuestError(() -> service.progress(a.id, a.owner.getId(), created.id(), occurrenceId),
                QuestErrorCode.QUEST_OCCURRENCE_NOT_FOUND);
        assertQuestError(() -> service.claim(a.id, a.owner.getId(), created.id(), occurrenceId, 1,
                UUID.randomUUID()), QuestErrorCode.QUEST_STATE_CONFLICT);
    }

    // ---------------------------------------------------------------- 도구

    private QuestViews.Created createFocus(Island island, User actor, String start, String end, int target) {
        return service.create(island.id, actor.getId(), "저녁 " + target + "분", "focus", target, start, end, null,
                UUID.randomUUID());
    }

    private UUID occurrenceOf(QuestViews.Created created) {
        return jdbc.queryForObject("SELECT id FROM island_quest_occurrences WHERE quest_id = ? AND occurrence_date = ?",
                UUID.class, created.id(), D);
    }

    private static Instant at(LocalDate date, String time) {
        Instant instant = Instant.parse(date + "T" + time + "Z");
        NOW.set(instant);
        return instant;
    }

    private Island island(boolean withBoard) {
        User owner = users.save(User.builder().nickname("방장-" + UUID.randomUUID()).build());
        Group group = groups.save(Group.builder().name("섬").maxMembers(10).build());
        members.save(GroupMember.builder().user(owner).group(group).role(GroupMemberRole.OWNER).build());
        if (withBoard) {
            IslandFacility board = IslandFacility.started(group.getId(), "board", 240, 1, owner.getId(),
                    Instant.parse("2031-01-01T00:00:00Z"), Instant.parse("2031-01-01T00:15:00Z"));
            board.complete(Instant.parse("2031-01-01T00:15:00Z"));
            facilities.save(board);
        }
        return new Island(group.getId(), group, owner);
    }

    private User resident(Group group) {
        User user = users.save(User.builder().nickname("주민-" + UUID.randomUUID()).build());
        members.save(GroupMember.builder().user(user).group(group).role(GroupMemberRole.MEMBER).build());
        return user;
    }

    private void leave(User user, Group group) {
        GroupMember membership = members.findByUserAndGroup(user, group).orElseThrow();
        membership.leave();
        members.save(membership);
    }

    private UUID session(User user, UUID islandId, FocusSessionLifecycle lifecycle) {
        UUID id = sessions.save(FocusSession.builder().user(user).focusType(FocusType.INFINITE)
                .startedAt(NOW.get()).build()).getId();
        details.save(FocusSessionDetail.builder().sessionId(id).userId(user.getId()).islandId(islandId)
                .membershipEpochAtStart(1L).subject("공부").targetMinutes(30).lifecycle(lifecycle)
                .lastTransitionAt(NOW.get()).build());
        return id;
    }

    private void interval(UUID sessionId, int ordinal, FocusIntervalKind kind, Instant startedAt, Instant endedAt) {
        intervals.save(FocusSessionInterval.builder().sessionId(sessionId).ordinal(ordinal).kind(kind)
                .startedAt(startedAt).endedAt(endedAt).build());
    }

    private int balance(UUID islandId) {
        return jdbc.query("SELECT balance FROM island_wallets WHERE island_id = ?",
                rs -> rs.next() ? rs.getInt(1) : 0, islandId);
    }

    private static QuestViews.Member member(QuestViews.Progress progress, User user) {
        return progress.members().stream().filter(m -> m.userId().equals(user.getId())).findFirst().orElseThrow();
    }

    private static void assertQuestError(org.assertj.core.api.ThrowableAssert.ThrowingCallable call,
                                         QuestErrorCode code) {
        assertThatThrownBy(call).isInstanceOfSatisfying(QuestException.class,
                e -> assertThat(e.getErrorCode()).isEqualTo(code));
    }

    private record Island(UUID id, Group group, User owner) {
    }
}
