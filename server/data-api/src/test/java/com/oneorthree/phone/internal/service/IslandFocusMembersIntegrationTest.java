package com.oneorthree.phone.internal.service;

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
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.internal.dto.IslandFocusMembersView;
import com.oneorthree.phone.internal.dto.IslandRestMembersView;
import com.oneorthree.phone.internal.dto.MemberWatermark;
import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 같이 낚시 초기 스냅샷 2종 (GROMO-1765 (a)) — 실 Flyway 스키마 위에서 운영 엔티티·저장소·version 발급기로
 * 데이터를 심고 읽는다. 시작 게이트가 닫혀 있어 start 명령으로는 세션을 만들 수 없으므로, 그 명령이 쓰는 것과
 * 같은 행(기본 마커 · 상세 · 구간 · aggregate version)을 직접 심는다.
 */
@SpringBootTest
class IslandFocusMembersIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired
    IslandFocusMembersService service;
    @Autowired
    UserRepository users;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    FocusSessionRepository sessions;
    @Autowired
    FocusSessionDetailRepository details;
    @Autowired
    FocusSessionIntervalRepository intervals;
    @Autowired
    OutboxCommandPort outbox;
    @Autowired
    PlatformTransactionManager transactionManager;

    /** PostgreSQL 이 마이크로초로 저장하므로 기대값을 같은 정밀도로 맞춘다. */
    private final Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);

    @Test
    @DisplayName("focus 목록은 active·paused 를 담고 completed·다른 섬 세션은 뺀다 — watermark 는 발급된 version 이다")
    void focusMembersListsProgressingResidentsWithWatermarks() {
        Island a = island();
        User active = resident(a.group);
        User paused = resident(a.group);
        User completed = resident(a.group);
        User elsewhere = resident(a.group);
        Group other = island().group;
        join(elsewhere, other);

        UUID activeSession = activeSession(active, a.id, now.minus(10, ChronoUnit.MINUTES));
        UUID pausedSession = pausedSession(paused, a.id);
        endedSession(completed, a.id);
        activeSession(elsewhere, other.getId(), now.minus(5, ChronoUnit.MINUTES));

        allocate("FOCUS_MEMBER", a.id, active.getId());
        allocate("FOCUS_MEMBER", a.id, active.getId());
        allocate("FOCUS_MEMBER", a.id, paused.getId());

        IslandFocusMembersView view = service.focusMembers(a.id, a.owner.getId());

        assertThat(view.serverNow()).isNotNull();
        assertThat(view.items()).extracting(IslandFocusMembersView.Item::userId)
                .containsExactlyInAnyOrder(active.getId(), paused.getId());
        IslandFocusMembersView.Item activeItem = item(view, active);
        assertThat(activeItem.sessionId()).isEqualTo(activeSession);
        assertThat(activeItem.status()).isEqualTo("active");
        assertThat(activeItem.name()).isEqualTo(active.getNickname());
        assertThat(activeItem.subject()).isEqualTo("알고리즘");
        assertThat(activeItem.activeSeconds()).isBetween(600L, 660L);
        IslandFocusMembersView.Item pausedItem = item(view, paused);
        assertThat(pausedItem.sessionId()).isEqualTo(pausedSession);
        assertThat(pausedItem.status()).isEqualTo("paused");
        // 닫힌 ACTIVE 10분만 센다 — 열린 REST 는 더하지 않는다.
        assertThat(pausedItem.activeSeconds()).isEqualTo(600L);

        assertThat(view.watermarks()).containsExactlyInAnyOrder(
                new MemberWatermark("focus.member", a.id, active.getId(), 2),
                new MemberWatermark("focus.member", a.id, paused.getId(), 1));
    }

    @Test
    @DisplayName("rest 목록은 paused 만 담는다 — rest.member 축의 version 을 따로 읽는다")
    void restMembersListsOnlyPaused() {
        Island a = island();
        User active = resident(a.group);
        User paused = resident(a.group);
        activeSession(active, a.id, now.minus(10, ChronoUnit.MINUTES));
        pausedSession(paused, a.id);

        allocate("FOCUS_MEMBER", a.id, paused.getId());
        allocate("FOCUS_MEMBER", a.id, paused.getId());
        allocate("REST_MEMBER", a.id, paused.getId());

        IslandRestMembersView view = service.restMembers(a.id, a.owner.getId());

        assertThat(view.serverNow()).isNotNull();
        assertThat(view.items()).hasSize(1);
        IslandRestMembersView.Item item = view.items().get(0);
        assertThat(item.userId()).isEqualTo(paused.getId());
        assertThat(item.name()).isEqualTo(paused.getNickname());
        assertThat(item.restSeat()).isEqualTo(1);
        assertThat(item.restStartedAt()).isEqualTo(now.minus(20, ChronoUnit.MINUTES));
        assertThat(view.watermarks()).containsExactly(
                new MemberWatermark("rest.member", a.id, paused.getId(), 1));
    }

    @Test
    @DisplayName("비주민은 두 목록 모두 403 MEMBER_ONLY 다")
    void nonResidentIsForbidden() {
        Island a = island();
        User outsider = users.save(User.builder().nickname("밖-" + UUID.randomUUID()).build());

        assertThatThrownBy(() -> service.focusMembers(a.id, outsider.getId()))
                .isInstanceOfSatisfying(GroupException.class, e -> {
                    assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.MEMBER_ONLY);
                    assertThat(e.getErrorCode().getStatus().value()).isEqualTo(403);
                });
        assertThatThrownBy(() -> service.restMembers(a.id, outsider.getId()))
                .isInstanceOfSatisfying(GroupException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.MEMBER_ONLY));
    }

    @Test
    @DisplayName("없는 섬 · 종료된 섬 · 떠난 주민은 모두 같은 403 MEMBER_ONLY 다 — 섬 존재가 새지 않는다")
    void missingEndedOrDepartedIsMemberOnly() {
        Island ended = island();
        ended.group.close();
        groups.save(ended.group);
        Island a = island();
        User departed = resident(a.group);
        leave(departed, a.group);

        for (UUID[] call : new UUID[][] {
                {UUID.randomUUID(), a.owner.getId()},
                {ended.id, ended.owner.getId()},
                {a.id, departed.getId()}}) {
            assertThatThrownBy(() -> service.focusMembers(call[0], call[1]))
                    .isInstanceOfSatisfying(GroupException.class,
                            e -> assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.MEMBER_ONLY));
            assertThatThrownBy(() -> service.restMembers(call[0], call[1]))
                    .isInstanceOfSatisfying(GroupException.class,
                            e -> assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.MEMBER_ONLY));
        }
    }

    @Test
    @DisplayName("떠난 주민의 진행 세션은 목록에 섞이지 않는다")
    void departedResidentSessionIsExcluded() {
        Island a = island();
        User stayed = resident(a.group);
        User departed = resident(a.group);
        activeSession(stayed, a.id, now.minus(5, ChronoUnit.MINUTES));
        pausedSession(departed, a.id);
        leave(departed, a.group);

        assertThat(service.focusMembers(a.id, a.owner.getId()).items())
                .extracting(IslandFocusMembersView.Item::userId).containsExactly(stayed.getId());
        assertThat(service.restMembers(a.id, a.owner.getId()).items()).isEmpty();
    }

    @Test
    @DisplayName("진행 중인 주민이 없으면 빈 목록과 serverNow 만 준다")
    void emptyIslandHasServerNow() {
        Island a = island();

        IslandFocusMembersView view = service.focusMembers(a.id, a.owner.getId());

        assertThat(view.items()).isEmpty();
        assertThat(view.watermarks()).isEmpty();
        assertThat(view.serverNow()).isNotNull();
    }

    @Test
    @DisplayName("두 조회는 REPEATABLE_READ 새 트랜잭션이다 — 목록과 watermark 가 한 스냅샷에서 읽힌다")
    void readsOneSnapshot() throws NoSuchMethodException {
        for (String name : new String[] {"focusMembers", "restMembers"}) {
            Transactional tx = IslandFocusMembersService.class.getMethod(name, UUID.class, UUID.class)
                    .getAnnotation(Transactional.class);
            assertThat(tx.isolation()).isEqualTo(Isolation.REPEATABLE_READ);
            assertThat(tx.propagation()).isEqualTo(Propagation.REQUIRES_NEW);
            assertThat(tx.readOnly()).isTrue();
        }
    }

    // ---------------------------------------------------------------- 도구

    private Island island() {
        User owner = users.save(User.builder().nickname("방장-" + UUID.randomUUID()).build());
        Group group = groups.save(Group.builder().name("섬").maxMembers(10).build());
        members.save(GroupMember.builder().user(owner).group(group).role(GroupMemberRole.OWNER).build());
        return new Island(group.getId(), group, owner);
    }

    private User resident(Group group) {
        User user = users.save(User.builder().nickname("주민-" + UUID.randomUUID()).build());
        join(user, group);
        return user;
    }

    private void join(User user, Group group) {
        members.save(GroupMember.builder().user(user).group(group).role(GroupMemberRole.MEMBER).build());
    }

    private void leave(User user, Group group) {
        GroupMember membership = members.findByUserAndGroup(user, group).orElseThrow();
        membership.leave();
        members.save(membership);
    }

    private UUID activeSession(User user, UUID islandId, Instant startedAt) {
        UUID id = marker(user, startedAt, null);
        detail(id, user, islandId, FocusSessionLifecycle.ACTIVE, null, startedAt);
        interval(id, 1, FocusIntervalKind.ACTIVE, startedAt, null);
        return id;
    }

    /** ACTIVE 30분 전~20분 전(10분) 뒤 20분 전부터 REST 중 — 자리 1. */
    private UUID pausedSession(User user, UUID islandId) {
        Instant started = now.minus(30, ChronoUnit.MINUTES);
        Instant pausedAt = now.minus(20, ChronoUnit.MINUTES);
        UUID id = marker(user, started, null);
        detail(id, user, islandId, FocusSessionLifecycle.PAUSED, 1, pausedAt);
        interval(id, 1, FocusIntervalKind.ACTIVE, started, pausedAt);
        interval(id, 2, FocusIntervalKind.REST, pausedAt, null);
        return id;
    }

    private void endedSession(User user, UUID islandId) {
        Instant started = now.minus(60, ChronoUnit.MINUTES);
        Instant ended = now.minus(30, ChronoUnit.MINUTES);
        UUID id = marker(user, started, ended);
        detail(id, user, islandId, FocusSessionLifecycle.COMPLETED, null, ended);
        interval(id, 1, FocusIntervalKind.ACTIVE, started, ended);
    }

    private UUID marker(User user, Instant startedAt, Instant endedAt) {
        return sessions.save(FocusSession.builder().user(user).focusType(FocusType.INFINITE)
                .startedAt(startedAt).endedAt(endedAt).build()).getId();
    }

    private void detail(UUID sessionId, User user, UUID islandId, FocusSessionLifecycle lifecycle, Integer restSeat,
                        Instant lastTransitionAt) {
        details.save(FocusSessionDetail.builder().sessionId(sessionId).userId(user.getId()).islandId(islandId)
                .membershipEpochAtStart(1L).subject("알고리즘").targetMinutes(25).lifecycle(lifecycle)
                .restSeat(restSeat).lastTransitionAt(lastTransitionAt).build());
    }

    private void interval(UUID sessionId, int ordinal, FocusIntervalKind kind, Instant startedAt, Instant endedAt) {
        intervals.save(FocusSessionInterval.builder().sessionId(sessionId).ordinal(ordinal).kind(kind)
                .startedAt(startedAt).endedAt(endedAt).build());
    }

    /** 수명주기 명령이 쓰는 것과 같은 발급기·같은 key 모양으로 version 을 올린다. */
    private void allocate(String type, UUID islandId, UUID userId) {
        new TransactionTemplate(transactionManager).executeWithoutResult(status ->
                outbox.allocateVersion(new AggregateRef(type, islandId + ":" + userId)));
    }

    private static IslandFocusMembersView.Item item(IslandFocusMembersView view, User user) {
        return view.items().stream().filter(i -> i.userId().equals(user.getId())).findFirst().orElseThrow();
    }

    private record Island(UUID id, Group group, User owner) {
    }
}
