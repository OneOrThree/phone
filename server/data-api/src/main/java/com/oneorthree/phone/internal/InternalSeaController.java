package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.FriendIdsView;
import com.oneorthree.phone.internal.dto.SeaRemarkRequest;
import com.oneorthree.phone.internal.dto.SeaStateView;
import com.oneorthree.phone.focus.service.SeaRemarkService;
import com.oneorthree.phone.internal.service.GuestAccountGuards;
import com.oneorthree.phone.internal.service.SeaStateService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 바다 한마디와 바다 방 입장용 조회 3종의 <b>내부 표면</b> (GROMO-2299, 바다 항해 계약 §2).
 *
 * <p>{@code PUT /sea-remark} 의 호출자는 Business(공개 {@code PUT /me/sea-remark}), 나머지 둘은 realtime 이다.
 * 바다 집중 세션 시작은 {@link InternalFocusSessionController} 의 {@code POST /focus-sessions/sea} 다.
 */
@RestController
@RequestMapping("/internal/users/{userId}")
@RequiredArgsConstructor
public class InternalSeaController {

    private final SeaRemarkService remarks;
    private final GuestAccountGuards guestAccountGuards;
    private final SeaStateService seaState;

    @PutMapping("/sea-remark")
    public SeaRemarkService.SeaRemarkView updateRemark(@PathVariable UUID userId,
                                                      @RequestBody SeaRemarkRequest body) {
        // 게스트는 서비스 앞에서 403 SOCIAL_LOGIN_REQUIRED — 방명록 쓰기와 같은 자리다.
        guestAccountGuards.requireMember(userId);
        return remarks.update(userId, body.remark());
    }

    @GetMapping("/sea-state")
    public SeaStateView state(@PathVariable UUID userId) {
        return seaState.state(userId);
    }

    @GetMapping("/friends/ids")
    public FriendIdsView friendIds(@PathVariable UUID userId) {
        return seaState.friendIds(userId);
    }
}
