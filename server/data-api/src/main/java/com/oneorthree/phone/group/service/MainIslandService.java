package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.port.MainIslandNamePort;
import com.oneorthree.phone.group.event.MainIslandTransferredEvent;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.UserIslandNameProjection;
import com.oneorthree.phone.group.repository.UserMainIslandRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.UserMainIsland;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * 메인 섬 — 「내 대표 섬」 (GROMO-1971).
 *
 * <h2>«지금 접속한 섬»과 다른 축이다</h2>
 * {@code user_island_contexts.current_island_id} 는 이동할 때마다 바뀌는 <b>위치</b>이고 이쪽은 친구 목록에까지
 * 나가는 <b>대표</b>다. 이 클래스는 그 컬럼을 읽지도 쓰지도 않는다 — 합치면 구경하러 잠깐 옮긴 것만으로 대표
 * 섬이 바뀐다.
 *
 * <h2>저장하지 않은 상태가 기본이다</h2>
 * {@code user_main_islands} 행은 사용자가 <b>직접 고르거나</b>({@link #choose}) <b>메인 섬을 잃어 옮겨질 때</b>
 * ({@link #onMembershipRevoked}) 만 생긴다. 행이 없으면 «가장 먼저 가입한 활성 섬»으로 도출한다. 그래서
 * 가입 경로마다 훅을 달지 않아도 「첫 소속 가입 직후의 메인 섬 = 그 섬」과 「추가 가입 때는 기존 유지」가
 * 동시에 성립하고, 레거시 {@code /api/v1/groups/{id}/join} 으로 들어온 사람과 이 기능 이전의 주민까지 같은
 * 규칙을 받는다(마이그레이션 백필도 필요 없다).
 *
 * <h2>이전은 사용자 단위로 직렬화된다</h2>
 * 회수 경로가 {@code users} 를 <b>공유</b> 잠금으로만 잡아, 같은 사람이 서로 다른 두 섬에서 동시에
 * 회수되면 두 트랜잭션이 나란히 돈다. 그대로 두면 판정과 후보 선택이 서로의 미커밋 상태 위에서 갈려
 * <b>이미 떠난 섬</b>이 메인으로 박힌다. 그래서 {@link #onMembershipRevoked} 는 어떤 읽기보다 먼저
 * 사용자 축 advisory 잠금을 잡는다 — 근거와 잠금 순서는 {@link UserMainIslandRepository#lockUserAxis}.
 *
 * <h2>도출과 이전의 규칙이 다르다 — 일부러다</h2>
 * 도출은 «가장 먼저», 이전은 «가장 최근»이다. 도출은 「처음 정착한 섬이 내 대표」라는 기본값이고, 이전은
 * 대표를 잃었을 때 «지금 가장 활발할 법한 곳»으로 보내는 복구다. 그래서 도출값을 잃는 순간 그 값을 행으로
 * 박제한다 — 박제하지 않으면 도출 규칙이 두 번째로 오래된 섬을 고르고, 그건 복구 규칙이 아니다.
 */
@Service
@RequiredArgsConstructor
public class MainIslandService implements MainIslandNamePort {

    /** 사용자별 이전 직렬화 축 — {@link UserMainIslandRepository#lockUserAxis} 의 키 접두어. */
    private static final String LOCK_AXIS_PREFIX = "main-island:";

    private final UserMainIslandRepository mainIslands;
    private final GroupMemberRepository groupMembers;
    private final GroupRepository groups;
    private final ApplicationEventPublisher events;

    /**
     * 이 사람의 메인 섬 — 고른 것이 있으면 그것, 없으면 가장 먼저 가입한 활성 섬.
     *
     * @param userId 대상
     * @return 메인 섬 id. <b>소속이 하나도 없으면 {@code null}</b> 이다 — 유효하지 않은 섬을 대신 내주지 않는다
     *         (소속 0 의 복구는 GROMO-1995 소관)
     */
    public UUID mainIslandId(UUID userId) {
        return effective(userId).map(UserIslandNameProjection::islandId).orElse(null);
    }

    @Override
    public Map<UUID, String> mainIslandNamesByUserId(Collection<UUID> userIds) {
        if (userIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, String> names = new LinkedHashMap<>();
        for (UserIslandNameProjection chosen : mainIslands.findChosenByUserIdIn(userIds)) {
            names.put(chosen.userId(), chosen.name());
        }
        List<UUID> undecided = new ArrayList<>(userIds);
        undecided.removeAll(names.keySet());
        if (!undecided.isEmpty()) {
            // 가입 순 오름차순이라 «첫 행»이 도출값이다. putIfAbsent 가 그 첫 행만 남긴다.
            for (UserIslandNameProjection active : groupMembers.findActiveIslandsJoinedAsc(undecided)) {
                names.putIfAbsent(active.userId(), active.name());
            }
        }
        return names;
    }

    /**
     * 사용자가 메인 섬을 직접 고른다 ({@code PATCH /me}).
     *
     * <p>활성 주민이 아닌 섬은 거절한다 — 안 막으면 남의 섬 이름이 내 친구들 목록에 뜬다. 공유 잠금으로
     * 확인하는 이유는 강퇴·이탈의 배타 잠금과 직렬화하기 위해서다: 잠그지 않으면 「고르는 중에 강퇴」가
     * 이 검사를 통과해 비주민 섬이 박제된다.
     *
     * @param userId   본인. 호출부가 같은 TX 에서 이미 users 배타 잠금을 잡았다
     * @param islandId 고른 섬
     * @return 고른 섬 id — 응답에 그대로 싣는다
     * @throws GroupException 403 {@code MEMBER_ONLY} — 그 섬의 활성 주민이 아니다
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public UUID choose(UUID userId, UUID islandId) {
        GroupMember membership = groupMembers.findActiveByUserIdAndGroupIdForShare(userId, islandId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));
        mainIslands.findById(userId).ifPresentOrElse(
                row -> row.moveTo(membership.getGroup()),
                () -> mainIslands.save(new UserMainIsland(userId, membership.getGroup())));
        return islandId;
    }

    /**
     * 멤버십이 끝났다 — 그 섬이 메인 섬이었으면 <b>가장 최근 가입한 남은 섬</b>으로 옮긴다 (요구 5).
     *
     * <p>이탈·강퇴·계정탈퇴의 <b>공통 지점</b>인 {@code LinkMembershipEventService.recordMembershipRevoked}
     * 하나에서만 불린다. 마킹 지점마다 달면 다섯 곳 중 하나만 빠져도 「탈퇴한 섬이 대표로 남는」 상태가
     * 조용히 생긴다.
     *
     * <p><b>남은 섬이 없으면 행을 지운다</b> — 유효하지 않은 섬을 남기지 않고, 아무 섬이나 지정하지도 않는다.
     * 그 상태의 복구는 GROMO-1995 소관이다.
     *
     * @param member 이탈 마킹이 <b>이미 끝난</b> 멤버십 행. 호출 TX 가 그 행을 잠그고 있다
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void onMembershipRevoked(GroupMember member) {
        UUID userId = member.getUser().getId();
        UUID revokedIslandId = member.getGroup().getId();
        // ⚠️ 어떤 «읽기»보다 먼저다. 회수 경로는 users 를 공유로만 잡아 같은 사람의 두 섬 회수가 나란히
        // 도는데, 아래 판정·후보 선택이 그 사이에 끼면 이미 떠난 섬이 메인으로 박힌다. READ COMMITTED 는
        // 문장마다 새 스냅샷을 뜨므로, 잠금을 먼저 잡아야 이어지는 조회가 앞선 회수의 «커밋된» 결과를 본다.
        mainIslands.lockUserAxis(LOCK_AXIS_PREFIX + userId);
        Optional<UserMainIsland> chosen = mainIslands.findById(userId);
        if (!wasMainIsland(member, chosen, userId, revokedIslandId)) {
            return;
        }
        // 이탈 마킹은 이 조회의 자동 플러시로 반영돼 있다 — 방금 떠난 섬은 후보에 없다.
        List<UserIslandNameProjection> remaining = groupMembers.findActiveIslandsJoinedAsc(List.of(userId));
        if (remaining.isEmpty()) {
            chosen.ifPresent(mainIslands::delete);
            return;
        }
        UserIslandNameProjection moved = remaining.get(remaining.size() - 1);
        // 방금 «활성 멤버십»으로 떠온 섬이라 존재가 증명돼 있다 — 프록시 참조로 잡아 조회도 잠금도 더하지
        // 않는다. 여기서 새 잠금을 잡으면 강퇴·탈퇴 경로의 잠금 순서가 이 기능 때문에 늘어난다.
        Group island = groups.getReferenceById(moved.islandId());
        chosen.ifPresentOrElse(
                row -> row.moveTo(island),
                () -> mainIslands.save(new UserMainIsland(userId, island)));
        events.publishEvent(new MainIslandTransferredEvent(userId, moved.islandId(), moved.name(), Instant.now()));
    }

    private Optional<UserIslandNameProjection> effective(UUID userId) {
        List<UserIslandNameProjection> chosen = mainIslands.findChosenByUserIdIn(List.of(userId));
        if (!chosen.isEmpty()) {
            return Optional.of(chosen.get(0));
        }
        List<UserIslandNameProjection> active = groupMembers.findActiveIslandsJoinedAsc(List.of(userId));
        return active.isEmpty() ? Optional.empty() : Optional.of(active.get(0));
    }

    /**
     * 방금 잃은 섬이 메인 섬이었는가 — 고른 행이 있으면 그것과 대조하고, 없으면 도출 규칙으로 판정한다.
     *
     * <p>도출 쪽을 «이탈 전 목록의 첫 행»으로 다시 뜨지 못하는 이유는 마킹이 이미 플러시됐기 때문이다.
     * 그래서 「이 멤버십보다 먼저 생긴 활성 멤버십이 없다」로 같은 것을 묻는다.
     */
    private boolean wasMainIsland(GroupMember member, Optional<UserMainIsland> chosen, UUID userId,
                                  UUID revokedIslandId) {
        if (chosen.isPresent()) {
            return chosen.get().getIsland().getId().equals(revokedIslandId);
        }
        return groupMembers.countActiveJoinedBefore(userId, member.getCreatedAt(), member.getId()) == 0;
    }
}
