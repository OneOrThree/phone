package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.focus.dto.session.FocusSessionView;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.focus.service.FocusMemberEvents;
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
 * <h2>비소속 방문자도 본다 (2026-09-19 확정)</h2>
 * 종전에는 비주민을 {@code MEMBER_ONLY} 로 막았다. 「같이 낚시」는 <b>섬에 들러 남들이 집중하는 모습을
 * 보는 것</b>이 기능의 절반이라, 그 문을 닫으면 방문자 화면이 텅 빈다. 방문자에게 내리는 내용은
 * 주민과 <b>같다</b> — 근거는 셋이다: ① 이 목록은 섬 광장에 앉아 있는 사람들의 모습 그 자체이고 앱이
 * 방문자에게도 같은 장면을 그린다, ② 같은 정보를 둘로 가르면 앱이 두 모양을 다뤄야 하고 언젠가
 * 한쪽만 바뀐다, ③ 이 목록의 필드(이름·과목·경과 시간·상태)는 주민이면 누구나 보는 값이라, 가입이
 * 열린 섬에서는 가려 봐야 「가입하면 보인다」로 끝난다.
 *
 * <p><b>섬의 존재·수명은 여전히 가린다.</b> 없는 섬·종료된 섬·탈퇴 계정은 그대로
 * {@code MEMBER_ONLY} 다 — 임의 {@code islandId} 를 넣어 보는 것만으로 섬의 존재가 새면 안 된다.
 * 섬에 «비공개» 속성이 생기면 그 판정이 들어갈 자리는 {@link #requireVisitableIsland} 한 곳이다.
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
        List<UUID> residents = requireVisitableIsland(islandId, userId);
        List<FocusSessionDetail> rows = progressing(islandId, PROGRESSING, residents);
        Instant now = anchor(rows);
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
                        FocusIntervalMath.activeSecondsAsOf(bySession.getOrDefault(row.getSessionId(), List.of()), now),
                        row.getLifecycle() == FocusSessionLifecycle.PAUSED
                                ? FocusSessionView.STATUS_PAUSED : FocusSessionView.STATUS_ACTIVE))
                .toList();
        return new IslandFocusMembersView(items, now, watermarks(MemberWatermark.FOCUS_MEMBER,
                FocusMemberEvents.FOCUS_AGGREGATE_TYPE, islandId, rows));
    }

    /** rest 목록 — paused 주민만, 자리 번호 순. */
    @Transactional(propagation = Propagation.REQUIRES_NEW, isolation = Isolation.REPEATABLE_READ, readOnly = true)
    public IslandRestMembersView restMembers(UUID islandId, UUID userId) {
        List<UUID> residents = requireVisitableIsland(islandId, userId);
        List<FocusSessionDetail> rows = progressing(islandId, List.of(FocusSessionLifecycle.PAUSED), residents);
        Instant now = anchor(rows);
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
                FocusMemberEvents.REST_AGGREGATE_TYPE, islandId, rows));
    }

    /**
     * 목록 전체가 쓰는 anchor 하나 — {@code max(벽시계, 모든 행의 lastTransitionAt)}. 물러난 벽시계로 열린 구간이
     * 음수가 되지 않게 누르되, 항목마다 따로 누르지 않고 이 값 하나로 activeSeconds 를 재고 serverNow 로 돌려준다
     * ({@code FocusSessionLifecycleService#toView} 와 같은 규칙, LLD §2 「같은 serverNow anchor」).
     */
    private Instant anchor(List<FocusSessionDetail> rows) {
        Instant now = clock.instant();
        for (FocusSessionDetail row : rows) {
            if (row.getLastTransitionAt().isAfter(now)) {
                now = row.getLastTransitionAt();
            }
        }
        return now;
    }

    /**
     * 활성 계정 · 살아 있는 섬 — 우체통({@code InternalIslandMailboxService#requireResident})에서
     * <b>주민 검사만 뺀</b> 술어다(클래스 주석의 비소속 관전 개방). 섬 부재·종료·탈퇴 계정은 그대로
     * 한 코드({@code MEMBER_ONLY})로 합쳐 임의 islandId 로 섬 존재가 새지 않게 한다.
     *
     * <p>반환값은 여전히 <b>활성 주민</b>이다 — 방문자에게도 「그 섬 주민의 목록」을 보여 주는 것이지
     * 「아무나의 세션」을 보여 주는 것이 아니다. 강퇴·탈퇴한 사람은 방문자 화면에서도 사라진다.
     *
     * @return 섬의 활성 주민 id — 목록 필터에 그대로 쓴다
     */
    private List<UUID> requireVisitableIsland(UUID islandId, UUID userId) {
        users.getCaller(userId);
        groups.findGroup(islandId)
                .filter(group -> group.getDeletedAt() == null && group.getStatus() != GroupStatus.ENDED)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));
        return members.findActiveMemberUserIdsByGroupId(islandId);
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
