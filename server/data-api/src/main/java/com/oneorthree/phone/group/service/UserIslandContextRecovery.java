package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.repository.UserIslandContextRepository;
import com.oneorthree.phone.group.repository.UserMainIslandRepository;
import com.oneorthree.phone.group.repository.domain.GroupLeaveReason;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.UserIslandContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * 소속을 잃었을 때 «지금 접속한 섬»을 복구한다 (GROMO-1995).
 *
 * <h2>이 클래스가 메우는 구멍</h2>
 * 종전에는 {@code current_island_id} 를 <b>null 로 되돌리는 코드가 하나도 없었다</b> — 유일한 writer 가
 * {@code moveTo} 이고 non-null 만 썼다. 그래서 이탈·강퇴 뒤에도 죽은 섬 id 가 그대로 남았고, 읽기 경로
 * ({@code IslandMembershipService#liveCurrentIsland})가 런타임에 접어 감추는 것으로 때웠다. 정책이
 * 「모든 주민은 마지막 소속 섬에서도 탈퇴할 수 있다」를 확정했으므로 그 상태를 <b>저장</b> 해야 한다.
 *
 * <h2>두 갈래</h2>
 * <ul>
 *   <li>남은 소속이 있으면 <b>남은 메인 섬</b>으로 옮긴다 — 정책 「다른 소속 섬이 있으면 … 남은 메인
 *       섬으로 이동한다」. 후보는 {@link MainIslandService#mainIslandId} 가 이미 계산해 둔 값이다.</li>
 *   <li>남은 소속이 없으면 사유와 함께 비운다 — 정책 「마지막 소속 섬에서 탈퇴하면 `04 · 혼자 시작 /
 *       기존 섬 참여` 화면으로 이동한다」. 사유를 함께 적지 않으면 «한 번도 없음»과 구별이 사라진다.</li>
 * </ul>
 *
 * <h2>호출 지점은 하나다</h2>
 * {@code LinkMembershipEventService.recordMembershipRevoked} — 자진이탈·강퇴·계정탈퇴·레거시 네 경로가
 * 전부 지나는 유일한 공통 지점이고, {@link MainIslandService#onMembershipRevoked} 가 이미 같은 이유로
 * 거기 걸려 있다. <b>그 호출 «뒤»여야 한다</b> — 메인 섬 이전이 먼저 커밋돼야 여기서 읽는 다음 섬이
 * 「이미 떠난 섬」이 아니다.
 *
 * <h2>잠금</h2>
 * 회수 경로는 {@code users} 를 <b>공유</b>로만 잡아 같은 사람의 두 섬 회수가 나란히 돈다. 그래서 어떤
 * 읽기보다 먼저 {@link MainIslandService} 와 <b>같은</b> 사용자 축 advisory 잠금을 잡는다 — 같은 키를
 * 같은 트랜잭션에서 다시 잡는 것은 재진입이라 비용이 없고, 축이 갈리면 두 훅이 서로의 미커밋 상태
 * 위에서 판정해 「떠난 섬이 현재 섬으로 박히는」 결과가 나온다. 잠금 순서 논증은
 * {@link UserMainIslandRepository#lockUserAxis} 에 있다.
 */
@Service
@RequiredArgsConstructor
@Transactional(propagation = Propagation.MANDATORY)
public class UserIslandContextRecovery {

    /** {@link MainIslandService} 와 <b>같은</b> 축이어야 한다 — 다르면 두 훅이 직렬화되지 않는다. */
    private static final String LOCK_AXIS_PREFIX = "main-island:";

    private final UserIslandContextRepository contexts;
    private final UserMainIslandRepository mainIslands;
    private final MainIslandService mainIslandService;

    /**
     * 멤버십이 끝났다 — 그 섬이 «지금 접속한 섬»이었으면 옮기거나 비운다.
     *
     * <p>잃은 섬이 현재 섬이 아니면 아무것도 하지 않는다. 다른 섬에서 강퇴됐다고 서 있던 자리를
     * 옮기지 않는다.
     *
     * @param member 이탈·강퇴 마킹이 <b>이미 끝난</b> 멤버십 행 — {@code leftReason} 이 채워져 있다
     */
    public void onMembershipRevoked(GroupMember member) {
        UUID userId = member.getUser().getId();
        mainIslands.lockUserAxis(LOCK_AXIS_PREFIX + userId);
        UserIslandContext context = contexts.findById(userId).orElse(null);
        if (context == null || !member.getGroup().getId().equals(context.getCurrentIslandId())) {
            return;
        }
        UUID next = mainIslandService.mainIslandId(userId);
        if (next == null) {
            context.release(reasonOf(member));
        } else {
            context.moveTo(next);
        }
    }

    /**
     * 상실 사유 — 멤버십의 이탈 사유를 그대로 옮긴다.
     *
     * <p>레거시 행처럼 사유가 비어 있으면 자진 탈퇴로 본다. 「모르는 값」을 새로 만들면 읽는 쪽이
     * 세 갈래가 되는데, 정책이 가르는 것은 «한 번도 없음 / 잃었음» 둘뿐이다.
     */
    private static GroupLeaveReason reasonOf(GroupMember member) {
        return member.getLeftReason() == null ? GroupLeaveReason.LEFT : member.getLeftReason();
    }
}
