package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.construction.service.IslandFacilityQueryService;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.group.repository.domain.UserIslandContext;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * {@code currentIslandId} 를 옮기는 경로가 공유하는 가드 (LLD §3.1·§3.6~§3.7, HLD §3).
 *
 * <p>섬 생성·현재 섬 이동·즉시 가입은 전부 «현재 섬을 바꾸는 쓰기»다 — 같은 경계를 서비스마다
 * 다시 쓰면 한쪽만 고쳐져 다른 쪽으로 우회가 열린다. 그래서 GROMO-1759 가 만들어 둔 가드를
 * 여기로 모으고, 1760 의 가입 경로도 같은 것을 호출한다.
 */
@Component
@RequiredArgsConstructor
public class IslandMovementGuards {

    /** 계정당 소속 상한 — 기존 {@code GroupService.MAX_JOINED_GROUPS} 와 같은 값이다. */
    private static final int MAX_JOINED_ISLANDS = 10;

    private final FocusSessionRepository focusSessionRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final IslandFacilityQueryService islandFacilityQueryService;

    /**
     * 진행 중 집중 세션이 있으면 거절한다 (LLD §3.1·§3.6, PRD M07).
     *
     * <p>GROMO-1764 의 집중 시작과 <b>같은</b> 저장소 메서드를 쓴다. 일시정지(paused) 세션도 기본 행의
     * {@code endedAt} 이 null 이라 같은 조회에 잡힌다 — "active/paused 가 없어야 한다"는 요구가 이 한
     * 조회로 충족된다.
     */
    public void requireNoLiveFocusSession(User user) {
        if (focusSessionRepository.findFirstByUserAndEndedAtIsNullOrderByStartedAtDesc(user).isPresent()) {
            throw new FocusException(FocusErrorCode.SESSION_IN_PROGRESS);
        }
    }

    public void requireJoinedIslandLimit(User user) {
        if (groupMemberRepository.countByUser(user) >= MAX_JOINED_ISLANDS) {
            throw new GroupException(GroupErrorCode.GROUP_LIMIT_EXCEEDED);
        }
    }

    /**
     * 출발 섬 전망대 조건 (LLD §3.1·§3.6, HLD §3).
     *
     * <p>현재 섬이 없으면 조건이 없다 — "첫 소속에는 기존 출발 섬이 없으므로 전망대 조건이 적용되지
     * 않는다"(HLD §3).
     *
     * <p><b>등식은 깨졌고, 그래도 여기는 통과가 맞다 (GROMO-1995).</b> 종전 주석은 "{@code
     * currentIslandId} 를 null 로 되돌리는 코드가 없으니 null = 한 번도 가진 적 없음"이라고 적어 뒀고,
     * 그 등식이 깨지기 전에 상실 사유가 필요하다고 경고했다. 이제 {@code UserIslandContextRecovery} 가
     * 마지막 소속을 잃은 사람의 컨텍스트를 비우므로 등식은 깨졌고, 그 경고대로 사유를 함께 남긴다
     * ({@code user_island_contexts.loss_reason}, V84).
     *
     * <p>그런데도 이 가드는 <b>여전히 통과</b> 다 — 정책이 「모든 주민은 마지막 소속 섬에서도 탈퇴할 수
     * 있다. 탈퇴하면 처음 온보딩의 `04 · 혼자 시작 / 기존 섬 참여` 화면으로 이동해 섬 만들기와 다른 섬
     * 참가하기 중 하나를 고른다」로 확정했기 때문이다. 우회가 아니라 <b>설계된 경로</b> 다: 출발 섬이
     * 없는 사람에게 출발 섬 전망대를 요구할 수 없다.
     *
     * <p><b>다음 사람에게.</b> {@code lossReason} 을 실제로 <b>읽어</b> 분기해야 하는 첫 자리는
     * 「마지막 소속 섬에서 강퇴된 사용자의 처리」다 — 정책이 아직 「추가 결정이 필요하다」로 비워 둔
     * 칸이고, 그 결정이 {@code KICKED} 만 다르게 대우하기로 하면 여기에 분기가 생긴다.
     */
    public void requireDepartureUnlocked(UserIslandContext context) {
        UUID departure = context.getCurrentIslandId();
        if (departure == null) {
            return;
        }
        requireObservatoryUnlocked(departure);
    }

    /**
     * 섬의 전망대가 열렸는지 — 건설 도메인(GROMO-1767)의 {@code island_facilities} 행으로 판정한다.
     * 전망대가 COMPLETED 가 아니면 403 {@link GroupErrorCode#OBSERVATORY_LOCKED} 다.
     */
    public void requireObservatoryUnlocked(UUID islandId) {
        if (!islandFacilityQueryService.hasObservatory(islandId)) {
            throw new GroupException(GroupErrorCode.OBSERVATORY_LOCKED);
        }
    }

    /** 종결·소프트 삭제된 섬은 «없는 섬» 과 같은 404 다. */
    public static void requireAlive(Group island) {
        if (!isAlive(island)) {
            throw new GroupException(GroupErrorCode.GROUP_NOT_FOUND);
        }
    }

    public static boolean isAlive(Group island) {
        return island.getDeletedAt() == null && island.getStatus() != GroupStatus.ENDED;
    }
}
