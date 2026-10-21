package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.appearance.service.AppearanceService;
import com.oneorthree.phone.focus.dto.session.FocusSessionView;
import com.oneorthree.phone.focus.repository.SeaRemarkRepository;
import com.oneorthree.phone.focus.repository.domain.SeaRemark;
import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.internal.dto.FriendIdsView;
import com.oneorthree.phone.internal.dto.SeaStateView;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * realtime 이 바다 방 입장 때 읽는 두 조회 (GROMO-2299, 계약 §2) — 사용자의 바다 상태와 친구 id.
 *
 * <p>진행 중 세션은 {@link FocusSessionLifecycleService#current} 를 그대로 쓴다 — 어긋난 마커 정리·단일 스냅샷 규칙을
 * 다시 만들지 않는다. 바다 세션의 {@code islandId} 는 목적지, {@code targetMinutes} 는 항해 분이다.
 */
@Service
@RequiredArgsConstructor
public class SeaStateService {

    private final FocusSessionLifecycleService lifecycle;
    private final SeaRemarkRepository remarks;
    private final FriendshipRepository friendships;
    private final UserQueryService userQueryService;
    private final AppearanceService appearances;

    public SeaStateView state(UUID userId) {
        FocusSessionView view = lifecycle.current(userId);
        SeaStateView.Session session = view == null || !FocusSessionView.KIND_SEA.equals(view.kind()) ? null
                : new SeaStateView.Session(view.id(), view.islandId(), view.targetMinutes(), view.activeSeconds(),
                        view.serverNow(), view.startedAt());
        SeaRemark remark = remarks.findById(userId).orElse(null);
        String shown = remark == null || remark.getRemark().isEmpty() ? null : remark.getRemark();
        User user = userQueryService.findActive(userId).orElse(null);
        return new SeaStateView(shown, remark == null ? null : remark.getChangedAt(), session,
                user == null ? null : user.getNickname(), user == null ? null : user.getCatColor(),
                appearances.equippedOf(List.of(userId)).get(userId));
    }

    @Transactional(readOnly = true)
    public FriendIdsView friendIds(UUID userId) {
        userQueryService.getCaller(userId);
        return new FriendIdsView(List.copyOf(friendships.findFriendUserIdsByUserId(userId)));
    }
}
