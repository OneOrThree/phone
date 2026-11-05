package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.service.GroupMemberService;
import com.oneorthree.phone.group.service.GroupMembershipMutationLocks;
import com.oneorthree.phone.internal.dto.HallLessIslandCleanupView;
import com.oneorthree.phone.internal.repository.HallLessIslandQuery;
import com.oneorthree.phone.user.repository.UserQueryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

/**
 * 마을회관 없는 섬 일회성 정리 (GROMO-2763, 2026-11-05 결정) — 운영자 명령. 절차는
 * {@code docs/prd/fishcat/island-membership/hall-less-island-cleanup.md}.
 *
 * <p>회관 없는 섬은 건물 트리의 뿌리가 없어 아무것도 지을 수 없다. {@code POST /islands} 가 회관 없이 섬을 만들던
 * 동안 생긴 섬을 닫는다. 주민 처리는 {@link GroupMemberService#closeIslandByOperator} 가 맡는다.
 *
 * <p><b>섬마다 트랜잭션 하나다.</b> 한 섬이 실패하면 그 섬만 롤백하고 다음 섬으로 넘어가 결과에 남긴다. 이 메서드
 * 자체는 트랜잭션을 열지 않는다 — 열면 섬 하나의 실패가 전부를 되돌린다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class HallLessIslandCleanupService {

    static final String CLOSED = "CLOSED";
    static final String SKIPPED = "SKIPPED";
    static final String FAILED = "FAILED";

    private final HallLessIslandQuery query;
    private final GroupMemberRepository members;
    private final UserQueryService users;
    private final GroupMembershipMutationLocks locks;
    private final GroupMemberService groupMembers;
    private final PlatformTransactionManager transactionManager;
    private final Clock clock;

    /** 대상과 영향만 센다. 아무것도 바꾸지 않는다. */
    public HallLessIslandCleanupView dryRun() {
        return new HallLessIslandCleanupView(true, summarize(), List.of());
    }

    /** 대상 섬을 하나씩 닫는다. */
    public HallLessIslandCleanupView execute() {
        HallLessIslandCleanupView.Summary summary = summarize();
        TransactionTemplate perIsland = new TransactionTemplate(transactionManager);
        List<HallLessIslandCleanupView.Outcome> outcomes = new ArrayList<>();
        for (UUID islandId : summary.islandIds()) {
            HallLessIslandCleanupView.Outcome outcome;
            try {
                Integer residents = perIsland.execute(status -> closeOne(islandId));
                outcome = new HallLessIslandCleanupView.Outcome(islandId, residents == null ? SKIPPED : CLOSED, null);
                log.info("마을회관 없는 섬 정리 island={} result={} residents={}", islandId, outcome.result(), residents);
            } catch (RuntimeException e) {
                // 응답에는 예외 종류만 싣는다 — DB 오류 문구에는 SQL 조각·사용자 id 가 섞일 수 있어 로그에만 남긴다.
                log.warn("마을회관 없는 섬 정리 실패 — 이 섬만 롤백했다 island={}", islandId, e);
                outcome = new HallLessIslandCleanupView.Outcome(islandId, FAILED, e.getClass().getSimpleName());
            }
            outcomes.add(outcome);
        }
        return new HallLessIslandCleanupView(false, summary, outcomes);
    }

    /** @return 내보낸 주민 수. 그사이 대상이 아니게 됐으면 {@code null} */
    private Integer closeOne(UUID islandId) {
        // users → islands → memberships 잠금 순서(섬 소속 LLD §4)를 지키려 주민의 users 행을 먼저 공유로 잡는다.
        Set<UUID> locked = new TreeSet<>(members.findActiveMemberUserIdsByGroupId(islandId));
        locked.forEach(users::findActiveForShare);
        locks.lockGroup(islandId);
        if (!query.isTarget(islandId)) {
            return null;
        }
        // 목록을 읽은 뒤 섬 잠금 전에 들어온 주민은 users 잠금 밖이다 — 순서를 어기고 진행하지 않고 이 섬만 실패로
        // 남긴다. 다시 부르면 새 목록으로 잠근다.
        if (!locked.containsAll(members.findActiveMemberUserIdsByGroupId(islandId))) {
            throw new IllegalStateException("잠그는 사이 주민이 바뀌었다 — 다시 부른다");
        }
        return groupMembers.closeIslandByOperator(islandId);
    }

    private HallLessIslandCleanupView.Summary summarize() {
        return query.summarize(LocalDate.ofInstant(clock.instant(), ZonePolicy.KST));
    }
}
