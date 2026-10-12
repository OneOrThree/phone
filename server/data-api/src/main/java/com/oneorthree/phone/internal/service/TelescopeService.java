package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.GroupRepository.TelescopeCandidate;
import com.oneorthree.phone.group.repository.IslandArrivalRepository;
import com.oneorthree.phone.group.repository.IslandJoinRequestRepository;
import com.oneorthree.phone.group.repository.IslandJoinRequestRepository.JoinRequestRef;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.internal.dto.TelescopeItemView;
import com.oneorthree.phone.internal.dto.TelescopeView;
import com.oneorthree.phone.internal.support.SailingTimes;
import com.oneorthree.phone.user.repository.UserQueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
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
 * 망원경 목록 (GROMO-2265, 섬 외부 계약 §5) — 사람마다, 1시간마다 바뀌는 섬 목록을 조립한다.
 *
 * <p><b>결정적</b>이다: 같은 사람·같은 1시간 버킷·같은 데이터면 같은 목록·순서·항해 분이 나온다. 아무것도 저장하지
 * 않고 버킷 시드({@code userId:버킷 epoch 초})로 후보 순서를 매번 다시 계산한다. 같은 버킷 안의 가입·강퇴·정원
 * 변동으로 목록이 바뀌는 것은 discover 와 같이 수용한다.
 *
 * <p>칸은 셋이고 응답도 이 순서다.
 * <ul>
 *   <li>{@code joined} — 활성 소속 섬 전부(≤3). 항해 분도 계산해 둔다.</li>
 *   <li>{@code nearby} — 정원 남은 첫 후보 하나, 항해 {@value #NEARBY_SAILING_MINUTES}분. 가까운 섬은 가입할 수
 *       있는 섬 중에서만 고르므로 정원 남은 후보가 없으면 이 라벨은 붙지 않는다.</li>
 *   <li>{@code random} — 나머지 새 섬 칸. 새 섬 칸은 가까운 섬 1 + 무작위 {@value #RANDOM_SLOTS} = 5칸이고 정원 남은
 *       섬부터, 모자라면 정원 찬 섬({@code full=true}, 구경만)으로 채우고, 그래도 모자라면 칸 수가 준다. 정원 남은
 *       섬이 하나도 없으면 다섯 칸 전부 정원 찬 {@code random} 섬이다.</li>
 * </ul>
 * nearby 가 아닌 항해 분은 {@link SailingTimes} 다 — 같은 버킷이면 승인 편지의 「N분 뒤 도착」과 같은 값이다.
 *
 * <p>전망대 게이트가 없고(망원경은 바다용) 게스트도 읽는다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class TelescopeService {

    static final String SLOT_JOINED = "joined";
    static final String SLOT_NEARBY = "nearby";
    static final String SLOT_RANDOM = "random";
    static final int NEARBY_SAILING_MINUTES = 15;
    static final int RANDOM_SLOTS = 4;

    private final UserQueryService userQueryService;
    private final GroupRepository groupRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final IslandJoinRequestRepository joinRequestRepository;
    private final IslandArrivalRepository arrivals;
    private final IslandFocusAverageReader averages;
    private final Clock clock;

    /**
     * 이 사람의 지금 버킷 목록.
     *
     * @param userId 망원경을 보는 사람 — 게스트도 된다
     * @return 버킷 시작·다음 목록까지 남은 분·칸 목록
     */
    public TelescopeView list(UUID userId) {
        userQueryService.getCaller(userId);
        Instant now = clock.instant();
        Instant bucketStart = now.truncatedTo(ChronoUnit.HOURS);

        List<UUID> joinedIds = groupMemberRepository.findActiveGroupIdsByUserId(userId);
        // 새 섬 칸(가까운 섬 1 + 무작위 4)만큼 읽는다 — 정원 남은 섬이 앞이고, 모자라면 찬 섬이 뒤를 채운다.
        List<TelescopeCandidate> shown = groupRepository.findTelescopeCandidates(userId.toString(),
                userId + ":" + bucketStart.getEpochSecond(), 1 + RANDOM_SLOTS);
        // 첫 후보가 찬 섬이면 열린 섬이 하나도 없다 — 가까운 섬 라벨 없이 전부 random 이다.
        boolean hasNearby = !shown.isEmpty() && !isFull(shown.get(0));

        List<UUID> shownIds = shown.stream().map(TelescopeCandidate::getId).toList();
        List<UUID> ids = Stream.concat(joinedIds.stream(), shownIds.stream()).toList();
        Map<UUID, Group> islands = groupRepository.findAllById(ids).stream()
                .collect(Collectors.toMap(Group::getId, Function.identity()));
        Map<UUID, OptionalInt> averageOf = averages.latest(ids);
        Set<UUID> arrived = ids.isEmpty() ? Set.of()
                : new HashSet<>(arrivals.findArrivedIslandIdsAmong(userId, ids));
        Map<UUID, JoinRequestRef> requests = shownIds.isEmpty() ? Map.of()
                : IslandSummaries.latestByIsland(
                        joinRequestRepository.findRefsByApplicantIdAndIslandIds(userId, shownIds));
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
                        averageOf.get(id), arrived.contains(id)));
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
                    averageOf.get(id), arrived.contains(id)));
        }
        // 60 − 버킷 안에서 지난 «온전한» 분 = ceil((bucketStart + 1h − now) / 1분). 정각엔 60, 59분 59초엔 1.
        int nextRefreshMinutes = 60 - (int) Duration.between(bucketStart, now).toMinutes();
        return new TelescopeView(bucketStart, nextRefreshMinutes, items);
    }

    private static boolean isFull(TelescopeCandidate candidate) {
        return candidate.getMemberCount() >= candidate.getMaxMembers();
    }

    private static TelescopeItemView item(Group island, long memberCount, int maxMembers, String membershipStatus,
                                          String slot, int sailingMinutes, OptionalInt average,
                                          boolean arrivedBefore) {
        return new TelescopeItemView(island.getId(), island.getName(), IslandSummaries.introOf(island),
                (int) memberCount, maxMembers, island.isApprovalRequired(), membershipStatus, slot, sailingMinutes,
                average.isPresent() ? average.getAsInt() : null, memberCount >= maxMembers, arrivedBefore);
    }
}
