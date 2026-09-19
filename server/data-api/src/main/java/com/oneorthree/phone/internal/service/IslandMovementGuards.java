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
     * <p><b>여기서 null 을 첫 소속으로 읽어도 되는 이유.</b> §3.6 은 "{@code currentIslandId=null} 을
     * 첫 소속으로 간주하지 않는다"고 경고하는데, 그 경고는 <b>현재 섬을 잃은 뒤의 null</b> 을 첫
     * 소속으로 오인해 전망대 gate 를 우회하는 경우를 막으려는 것이다(IM-D06). 이 레포에는 아직
     * {@code currentIslandId} 를 <b>null 로 되돌리는 코드가 없다</b> — 유일한 writer 가
     * {@code moveTo} 이고 non-null 만 쓴다. 그래서 오늘 null 은 «한 번도 가진 적이 없다» 와 동치다.
     *
     * <p><b>다음 사람에게.</b> 이탈·강퇴·섬 종료가 컨텍스트를 해제하는 경로를 넣는 순간 이 등식이
     * 깨진다. 그 경로를 만들기 전에 IM-D06(상실 이유·복구 근거)이 승인돼야 하고 이 메서드는 그때
     * {@code lossReason} 을 읽도록 바뀌어야 한다. 순서를 뒤집어 컨텍스트 해제를 먼저 넣으면 «이탈 →
     * null → 첫 소속으로 재선택» 으로 전망대를 우회할 수 있다.
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
