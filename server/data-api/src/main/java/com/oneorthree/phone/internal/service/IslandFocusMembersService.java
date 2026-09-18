package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.focus.dto.session.FocusSessionView;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.focus.support.FocusIntervalMath;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.internal.dto.IslandFocusMembersView;
import com.oneorthree.phone.internal.dto.IslandRestMembersView;
import com.oneorthree.phone.internal.dto.MemberWatermark;
import com.oneorthree.phone.outbox.repository.AggregateVersionRepository;
import com.oneorthree.phone.outbox.repository.domain.AggregateVersion;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 「같이 낚시」 초기 스냅샷 2종 (GROMO-1765 (a), focus-rest-session LLD §2 focus-group / rest-members) —
 * {@code GET /islands/{islandId}/focus-members} · {@code /rest-members} 의 Data 쪽.
 *
 * <h2>한 스냅샷</h2>
 * 주민·상세·구간·기본 마커·이름·watermark 를 여러 SELECT 로 읽는다. READ COMMITTED 는 문장마다 새 스냅샷이라
 * 그 사이 pause 가 커밋되면 「paused 인데 watermark 는 pause 이전 version」 같은 조합이 나가고, 앱은 그 pause
 * 사건을 version 비교로 버린다 — 영구 불일치다. LLD 가 watermark 를 「해당 상태와 같은 DB snapshot」에서
 * 읽으라고 정했으므로 REPEATABLE READ 로 트랜잭션 스냅샷을 하나로 고정한다. {@code REQUIRES_NEW} 인 이유는
 * {@link FocusSessionLifecycleService#current} 와 같다(기존 트랜잭션에 참여하면 격리 수준이 조용히 무시된다).
 *
 * <h2>무엇을 싣지 않는가</h2>
 * catColor·appearance·appearanceVersion — 제공자가 main 에 없다({@link IslandFocusMembersView} 참조).
 *
 * <h2>기본 마커가 닫힌 진행 세션</h2>
 * 레거시 start 가 v0.3 세션의 기본 행을 닫으면 상세만 진행 중으로 남는다
 * ({@code FocusSessionLifecycleService#abandonIfMarkerClosed}). 이 GET 은 읽기 전용이라 그 행을 정리하지
 * 않고 <b>목록에서 뺀다</b> — 이미 끝난 사람을 집중 중으로 그리지 않는다. 정리는 본인의 current/start 가 한다.
 */
@Service
@RequiredArgsConstructor
public class IslandFocusMembersService {

    private static final List<FocusSessionLifecycle> PROGRESSING =
            List.of(FocusSessionLifecycle.ACTIVE, FocusSessionLifecycle.PAUSED);

    private final UserQueryService users;
    private final GroupQueryService groups;
    private final GroupMemberRepository members;
    private final FocusSessionRepository focusSessionRepository;
    private final FocusSessionDetailRepository details;
    private final FocusSessionIntervalRepository intervals;
    private final AggregateVersionRepository aggregateVersions;
    private final Clock clock;

    /** focus 목록 — 진행 중(active/paused) 주민. completed·abandoned 는 없다. */
    @Transactional(propagation = Propagation.REQUIRES_NEW, isolation = Isolation.REPEATABLE_READ, readOnly = true)
    public IslandFocusMembersView focusMembers(UUID islandId, UUID userId) {
        List<UUID> residents = requireResident(islandId, userId);
        Instant now = clock.instant();
        List<FocusSessionDetail> rows = progressing(islandId, PROGRESSING, residents);
        if (rows.isEmpty()) {
            return new IslandFocusMembersView(List.of(), now, List.of());
        }
        Map<UUID, List<FocusSessionInterval>> bySession = intervals
                .findBySessionIdInOrderByOrdinalAsc(rows.stream().map(FocusSessionDetail::getSessionId).toList())
                .stream().collect(Collectors.groupingBy(FocusSessionInterval::getSessionId));
        Map<UUID, String> names = names(rows);

        List<IslandFocusMembersView.Item> items = rows.stream()
                .sorted(Comparator.comparing(FocusSessionDetail::getCreatedAt))
                .map(row -> new IslandFocusMembersView.Item(row.getUserId(), names.get(row.getUserId()),
                        row.getSessionId(), row.getSubject(),
                        // 물러난 벽시계로 열린 구간이 음수가 되지 않게 anchor 를 직전 전이 이후로 누른다.
                        FocusIntervalMath.activeSecondsAsOf(bySession.getOrDefault(row.getSessionId(), List.of()),
                                row.getLastTransitionAt().isAfter(now) ? row.getLastTransitionAt() : now),
                        row.getLifecycle() == FocusSessionLifecycle.PAUSED
                                ? FocusSessionView.STATUS_PAUSED : FocusSessionView.STATUS_ACTIVE))
                .toList();
        return new IslandFocusMembersView(items, now, watermarks(MemberWatermark.FOCUS_MEMBER,
                FocusSessionLifecycleService.FOCUS_MEMBER_AGGREGATE_TYPE, islandId, rows));
    }

    /** rest 목록 — paused 주민만, 자리 번호 순. */
    @Transactional(propagation = Propagation.REQUIRES_NEW, isolation = Isolation.REPEATABLE_READ, readOnly = true)
    public IslandRestMembersView restMembers(UUID islandId, UUID userId) {
        List<UUID> residents = requireResident(islandId, userId);
        Instant now = clock.instant();
        List<FocusSessionDetail> rows = progressing(islandId, List.of(FocusSessionLifecycle.PAUSED), residents);
        if (rows.isEmpty()) {
            return new IslandRestMembersView(List.of(), now, List.of());
        }
        Map<UUID, String> names = names(rows);

        List<IslandRestMembersView.Item> items = rows.stream()
                .sorted(Comparator.comparing(FocusSessionDetail::getRestSeat))
                // paused 로 들어오는 길은 applyPause 하나이고, 그 t 가 열린 REST 구간의 시작과 같다.
                .map(row -> new IslandRestMembersView.Item(row.getUserId(), names.get(row.getUserId()),
                        row.getRestSeat(), row.getLastTransitionAt()))
                .toList();
        return new IslandRestMembersView(items, now, watermarks(MemberWatermark.REST_MEMBER,
                FocusSessionLifecycleService.REST_MEMBER_AGGREGATE_TYPE, islandId, rows));
    }

    /**
     * 활성 계정 · 살아 있는 섬 · 활성 주민 — 우체통({@code InternalIslandMailboxService#requireResident})과 같은
     * 술어다. 섬 부재·종료와 비주민을 한 코드({@code MEMBER_ONLY})로 합쳐 임의 islandId 로 섬 존재가 새지 않게 한다.
     *
     * @return 섬의 활성 주민 id — 목록 필터에 그대로 쓴다
     */
    private List<UUID> requireResident(UUID islandId, UUID userId) {
        users.getCaller(userId);
        groups.findGroup(islandId)
                .filter(group -> group.getDeletedAt() == null && group.getStatus() != GroupStatus.ENDED)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));
        List<UUID> residents = members.findActiveMemberUserIdsByGroupId(islandId);
        if (!residents.contains(userId)) {
            throw new GroupException(GroupErrorCode.MEMBER_ONLY);
        }
        return residents;
    }

    /** 진행 상세 중 기본 마커가 아직 열린 것만 — 닫힌 것은 이미 끝난 세션이다(클래스 주석). */
    private List<FocusSessionDetail> progressing(UUID islandId, List<FocusSessionLifecycle> lifecycles,
                                                 List<UUID> residents) {
        List<FocusSessionDetail> rows =
                details.findByIslandIdAndLifecycleInAndUserIdIn(islandId, lifecycles, residents);
        Set<UUID> closed = focusSessionRepository.findAllById(rows.stream().map(FocusSessionDetail::getSessionId)
                        .toList()).stream()
                .filter(marker -> marker.getEndedAt() != null)
                .map(FocusSession::getId)
                .collect(Collectors.toSet());
        return rows.stream().filter(row -> !closed.contains(row.getSessionId())).toList();
    }

    /** 닉네임은 온보딩 전이면 null 일 수 있어 toMap(null 값 거부) 대신 HashMap 에 담는다. */
    private Map<UUID, String> names(List<FocusSessionDetail> rows) {
        Map<UUID, String> names = new HashMap<>();
        for (User user : users.findAllActive(rows.stream().map(FocusSessionDetail::getUserId).toList())) {
            names.put(user.getId(), user.getNickname());
        }
        return names;
    }

    /** 목록의 각 주민 key 의 마지막 발급 version — 같은 스냅샷에서 읽고, 없으면 0. */
    private List<MemberWatermark> watermarks(String projection, String aggregateType, UUID islandId,
                                             List<FocusSessionDetail> rows) {
        Map<String, Long> versions = aggregateVersions.findByAggregateTypeAndAggregateIdIn(aggregateType,
                        rows.stream().map(row -> islandId + ":" + row.getUserId()).toList()).stream()
                .collect(Collectors.toMap(AggregateVersion::getAggregateId, AggregateVersion::getLastVersion));
        return rows.stream()
                .map(row -> new MemberWatermark(projection, islandId, row.getUserId(),
                        versions.getOrDefault(islandId + ":" + row.getUserId(), 0L)))
                .toList();
    }
}
