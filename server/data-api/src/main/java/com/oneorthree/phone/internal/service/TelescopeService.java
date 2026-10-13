package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.GroupRepository.TelescopeCandidate;
import com.oneorthree.phone.group.repository.IslandArrivalRepository;
import com.oneorthree.phone.group.repository.IslandJoinRequestRepository;
import com.oneorthree.phone.group.repository.IslandJoinRequestRepository.JoinRequestRef;
import com.oneorthree.phone.group.repository.TelescopePinRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.TelescopePin;
import com.oneorthree.phone.internal.dto.TelescopeItemView;
import com.oneorthree.phone.internal.dto.TelescopeView;
import com.oneorthree.phone.internal.support.SailingTimes;
import com.oneorthree.phone.user.repository.UserQueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.Assert;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.OptionalInt;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * 망원경 목록 (GROMO-2265, 섬 외부 계약 §5) 과 직접 넣은 섬 «핀» (GROMO-2268, §6) — 사람마다, 1시간마다 바뀌는 섬
 * 목록을 조립한다.
 *
 * <p><b>결정적</b>이다: 같은 사람·같은 1시간 버킷·같은 데이터(핀 포함)면 같은 목록·순서·항해 분이 나온다. 핀 말고는
 * 아무것도 저장하지 않고 버킷 시드({@code userId:버킷 epoch 초})로 후보 순서를 매번 다시 계산한다. 같은 버킷 안의
 * 가입·강퇴·정원 변동으로 목록이 바뀌는 것은 discover 와 같이 수용한다. 그래서 핀을 빼면 별도 복귀 로직 없이 그 자리에
 * 같은 버킷의 다음 무작위 섬이 돌아온다.
 *
 * <p>칸은 넷이고 응답도 이 순서다.
 * <ul>
 *   <li>{@code joined} — 활성 소속 섬 전부(≤3). 항해 분도 계산해 둔다.</li>
 *   <li>{@code nearby} — <b>핀이 아닌 첫 후보</b>가 정원이 남아 있을 때 그 섬 하나, 항해 {@value #NEARBY_SAILING_MINUTES}분.
 *       가까운 섬은 가입할 수 있는 섬 중에서만 고르므로 정원 남은 후보가 없으면 이 라벨은 붙지 않는다. 핀 섬은 후보에서
 *       빠지므로 핀으로 넣은 섬이 가까운 섬이 되는 일은 없다.</li>
 *   <li>{@code pinned} — 직접 넣은 섬(핀). 만료(다음 07:00 KST) 전인 핀을 넣은 순서(오래된 것 먼저)로 보여 주고, 최대
 *       {@value #MAX_PINS}개다(그보다 많으면 가장 오래된 것부터 감춘다 — 감춘 핀은 후보에서도 빠져 어느 칸에도 나오지 않고
 *       다음 핀 넣기가 정리한다). 정원 찬 섬도 넣을 수 있다({@code full=true}, 구경만). 핀 섬이 그사이 비공개·종료·강퇴·내
 *       소속이 되면 이 칸에서 빠지고 그 칸은 random 이 채운다(핀 행은 만료까지 남는다).</li>
 *   <li>{@code random} — 나머지 새 섬 칸. 새 섬 칸은 가까운 섬 1 + 무작위 {@value #RANDOM_SLOTS} − 핀 수이고 정원 남은
 *       섬부터, 모자라면 정원 찬 섬({@code full=true}, 구경만)으로 채우고, 그래도 모자라면 칸 수가 준다. 정원 남은
 *       섬이 하나도 없으면 새 섬 칸 전부가 정원 찬 {@code random} 섬이다.</li>
 * </ul>
 * 핀은 최대 {@value #MAX_PINS}(= 무작위 칸 수)개라 새 섬 칸은 늘 1 이상이다 — 핀이 가득 차도 가까운 섬 후보는 하나 보인다.
 * nearby 가 아닌 항해 분은 {@link SailingTimes} 다 — 같은 버킷이면 승인 편지의 「N분 뒤 도착」과 같은 값이다(핀 섬도 같다).
 *
 * <p>전망대 게이트가 없고(망원경은 바다용) 게스트도 읽는다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class TelescopeService {

    static final String SLOT_JOINED = "joined";
    static final String SLOT_NEARBY = "nearby";
    static final String SLOT_PINNED = "pinned";
    static final String SLOT_RANDOM = "random";
    static final int NEARBY_SAILING_MINUTES = 15;
    static final int RANDOM_SLOTS = 4;
    /** 핀은 무작위 칸을 대신한다 — 무작위 칸 수를 넘지 않아야 새 섬 칸(1 + 4 − 핀 수)이 1 아래로 내려가지 않는다. */
    static final int MAX_PINS = RANDOM_SLOTS;

    private final UserQueryService userQueryService;
    private final GroupRepository groupRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final IslandJoinRequestRepository joinRequestRepository;
    private final IslandArrivalRepository arrivals;
    private final TelescopePinRepository pins;
    private final IslandFocusAverageReader averages;
    private final Clock clock;

    /**
     * 보여 줄 수 있는 핀 하나 — 핀 행(출처·넣은 시각)과, 후보와 같은 술어를 지금도 통과한 섬 행(주민 수·정원).
     *
     * @param pin 핀 행
     * @param row 그 섬의 주민 수·정원
     */
    public record VisiblePin(TelescopePin pin, TelescopeCandidate row) {
    }

    /**
     * 이 사람의 지금 버킷 목록.
     *
     * @param userId 망원경을 보는 사람 — 게스트도 된다
     * @return 버킷 시작·다음 목록까지 남은 분·칸 목록
     */
    public TelescopeView list(UUID userId) {
        return list(userId, clock.instant());
    }

    /**
     * 정해 준 시각으로 조립한다 — 핀을 넣은 요청이 «넣은 시각» 하나로 그 핀의 항목을 목록과 똑같이 내도록
     * {@link TelescopePinService} 가 부른다.
     *
     * @param userId 망원경을 보는 사람 — 게스트도 된다
     * @param now    목록을 만드는 시각
     * @return 버킷 시작·다음 목록까지 남은 분·칸 목록
     */
    public TelescopeView list(UUID userId, Instant now) {
        userQueryService.getCaller(userId);
        Instant bucketStart = now.truncatedTo(ChronoUnit.HOURS);

        List<UUID> joinedIds = groupMemberRepository.findActiveGroupIdsByUserId(userId);
        // 직접 넣은 섬 — 만료 전이고 지금도 보여 줄 수 있는 것만, 넣은 순서로 최대 MAX_PINS 개. 보이는 핀이 그보다 많으면
        // (비공개였다가 되살아난 핀 등) 가장 오래된 것부터 감춘다 — 핀을 넣을 때 밀어내는 규칙과 같다.
        List<VisiblePin> visible = visiblePins(userId, now);
        List<VisiblePin> pinned = visible.subList(Math.max(0, visible.size() - MAX_PINS), visible.size());
        List<UUID> pinnedIds = pinned.stream().map(pin -> pin.row().getId()).toList();
        // 새 섬 칸(가까운 섬 1 + 무작위 4)에서 핀 수만큼 무작위 칸이 준다. 핀이 MAX_PINS 로 막혀 1 아래로 가지 않는다.
        int newIslandSlots = 1 + RANDOM_SLOTS - pinned.size();
        Assert.state(newIslandSlots >= 1, () -> "핀이 무작위 칸 수를 넘었다: " + pinned.size());
        // 정원 남은 섬이 앞이고, 모자라면 찬 섬이 뒤를 채운다. 핀 섬은 후보에서 뺀다 — 안 빼면 한 섬이 두 번 나온다. 화면에 나오는
        // 핀(pinned)이 아니라 보이는 핀 전부(visible)를 뺀다 — 감춘(잘린) 핀이 «찜» 표시 없이 일반 칸으로 나오면 안 된다.
        List<UUID> visibleIds = visible.stream().map(pin -> pin.row().getId()).toList();
        List<TelescopeCandidate> shown = groupRepository.findTelescopeCandidates(userId.toString(),
                userId + ":" + bucketStart.getEpochSecond(), newIslandSlots, uuidArray(visibleIds));
        // 첫 후보(핀이 아닌 후보 중 첫 섬)가 찬 섬이면 열린 섬이 하나도 없다 — 가까운 섬 라벨 없이 전부 random 이다.
        boolean hasNearby = !shown.isEmpty() && !isFull(shown.get(0));

        List<UUID> shownIds = shown.stream().map(TelescopeCandidate::getId).toList();
        List<UUID> freshIds = Stream.concat(pinnedIds.stream(), shownIds.stream()).toList();
        List<UUID> ids = Stream.concat(joinedIds.stream(), freshIds.stream()).toList();
        Map<UUID, Group> islands = groupRepository.findAllById(ids).stream()
                .collect(Collectors.toMap(Group::getId, Function.identity()));
        Map<UUID, OptionalInt> averageOf = averages.latest(ids);
        Set<UUID> arrived = ids.isEmpty() ? Set.of()
                : new HashSet<>(arrivals.findArrivedIslandIdsAmong(userId, ids));
        Map<UUID, JoinRequestRef> requests = freshIds.isEmpty() ? Map.of()
                : IslandSummaries.latestByIsland(
                        joinRequestRepository.findRefsByApplicantIdAndIslandIds(userId, freshIds));
        Map<UUID, Integer> joinedCounts = new HashMap<>();
        if (!joinedIds.isEmpty()) {
            groupMemberRepository.countByGroupIdIn(joinedIds)
                    .forEach(row -> joinedCounts.put(row.getGroupId(), (int) row.getMemberCount()));
        }

        List<TelescopeItemView> items = new ArrayList<>(ids.size());
        for (UUID id : joinedIds) {
            Group island = islands.get(id);
            if (island != null && IslandMovementGuards.isAlive(island)) {
                items.add(item(island, joinedCounts.getOrDefault(id, 0), island.getMaxMembers(),
                        IslandSummaries.STATUS_ACTIVE, SLOT_JOINED, SailingTimes.minutes(userId, id, bucketStart),
                        averageOf.get(id), arrived.contains(id), null, null));
            }
        }
        for (int i = 0; i < shown.size(); i++) {
            TelescopeCandidate candidate = shown.get(i);
            UUID id = candidate.getId();
            Group island = islands.get(id);
            if (island == null) {
                continue;
            }
            boolean nearby = hasNearby && i == 0;
            // 주민 수·정원은 정렬에 쓴 바로 그 행의 값이다 — full 표시와 칸 순서가 서로 어긋나지 않는다.
            items.add(item(island, candidate.getMemberCount(), candidate.getMaxMembers(),
                    IslandSummaries.statusOf(false, requests.get(id)), nearby ? SLOT_NEARBY : SLOT_RANDOM,
                    nearby ? NEARBY_SAILING_MINUTES : SailingTimes.minutes(userId, id, bucketStart),
                    averageOf.get(id), arrived.contains(id), null, null));
        }
        // 핀은 가까운 섬 다음, 무작위 앞이다 — 위에서 joined → nearby → random 순으로 쌓았으니 첫 random 앞에 끼운다.
        List<TelescopeItemView> pinnedItems = new ArrayList<>(pinned.size());
        for (VisiblePin entry : pinned) {
            TelescopeCandidate row = entry.row();
            UUID id = row.getId();
            Group island = islands.get(id);
            if (island == null) {
                continue;
            }
            pinnedItems.add(item(island, row.getMemberCount(), row.getMaxMembers(),
                    IslandSummaries.statusOf(false, requests.get(id)), SLOT_PINNED,
                    SailingTimes.minutes(userId, id, bucketStart), averageOf.get(id), arrived.contains(id),
                    entry.pin().getSource(), entry.pin().getPinnedAt()));
        }
        int firstRandom = (int) items.stream().takeWhile(view -> !SLOT_RANDOM.equals(view.slot())).count();
        items.addAll(firstRandom, pinnedItems);
        // 60 − 버킷 안에서 지난 «온전한» 분 = ceil((bucketStart + 1h − now) / 1분). 정각엔 60, 59분 59초엔 1.
        int nextRefreshMinutes = 60 - (int) Duration.between(bucketStart, now).toMinutes();
        return new TelescopeView(bucketStart, nextRefreshMinutes, items);
    }

    /**
     * 만료 전 핀 중 지금도 보여 줄 수 있는 섬 — 넣은 순서(오래된 것 먼저), 개수 제한 없음. 비공개·종료·강퇴·내 소속이 된
     * 섬은 후보와 같은 술어({@code GroupRepository#TELESCOPE_VISIBLE_SQL})에서 빠진다.
     *
     * <p>개수를 자르는 일은 호출자 몫이다. 목록은 가장 최근의 {@value #MAX_PINS} 개만 보여 주되 후보에서는 여기 있는 핀을
     * 전부 빼고, 핀을 넣는 쪽은 그 수를 넘은 만큼 (지금 넣는 섬을 뺀) 가장 오래된 것부터 밀어낸다.
     *
     * @param userId 핀의 주인
     * @param now    «만료 전» 의 기준 시각 — {@code expires_at > now}
     * @return 보여 줄 수 있는 핀, 오래된 것 먼저
     */
    public List<VisiblePin> visiblePins(UUID userId, Instant now) {
        List<TelescopePin> live = pins.findLive(userId, now);
        if (live.isEmpty()) {
            return List.of();
        }
        List<UUID> liveIds = live.stream().map(TelescopePin::getIslandId).toList();
        Map<UUID, TelescopeCandidate> visible = groupRepository
                .findTelescopeVisibleAmong(userId.toString(), uuidArray(liveIds)).stream()
                .collect(Collectors.toMap(TelescopeCandidate::getId, Function.identity()));
        return live.stream().filter(pin -> visible.containsKey(pin.getIslandId()))
                .map(pin -> new VisiblePin(pin, visible.get(pin.getIslandId()))).toList();
    }

    private static boolean isFull(TelescopeCandidate candidate) {
        return candidate.getMemberCount() >= candidate.getMaxMembers();
    }

    /** Postgres uuid 배열 리터럴 — 비면 {@code {}} 다. UUID 문자열은 16진수와 하이픈뿐이라 따옴표가 필요 없다. */
    private static String uuidArray(Collection<UUID> ids) {
        return ids.stream().map(UUID::toString).collect(Collectors.joining(",", "{", "}"));
    }

    private static TelescopeItemView item(Group island, long memberCount, int maxMembers, String membershipStatus,
                                          String slot, int sailingMinutes, OptionalInt average,
                                          boolean arrivedBefore, String pinnedFrom, Instant pinnedAt) {
        return new TelescopeItemView(island.getId(), island.getName(), IslandSummaries.introOf(island),
                (int) memberCount, maxMembers, island.isApprovalRequired(), membershipStatus, slot, sailingMinutes,
                average.isPresent() ? average.getAsInt() : null, memberCount >= maxMembers, arrivedBefore,
                pinnedFrom, pinnedAt);
    }
}
