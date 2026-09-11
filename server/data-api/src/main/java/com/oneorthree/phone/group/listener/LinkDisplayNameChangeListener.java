package com.oneorthree.phone.group.listener;

import com.oneorthree.phone.group.service.LinkMembershipEventService;
import com.oneorthree.phone.user.event.UserDisplayNameChangedEvent;
import lombok.RequiredArgsConstructor;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * 닉네임 변경 → 링크 표시정보 갱신 명령 (A22 ㋡).
 *
 * <p><b>동기 리스너다.</b> {@code @Async}·{@code AFTER_COMMIT} 이 아닌 이유는 이 갱신이 「부가 통지」가
 * 아니라 <b>같은 커밋에 있어야 하는 사실</b>이기 때문이다 — 커밋 이후로 미루면 그 사이 프로세스가
 * 죽었을 때 링크 서버는 옛 이름을 든 채 남고, 현행처럼 「열 때마다 코어에서 이름을 다시 읽는」
 * 경로가 분리 후에는 없다.
 *
 * <p>실패하면 프로필 수정도 함께 롤백된다. 그것이 의도다 — 이름이 바뀐 사실과 그 사실을 나를 명령이
 * 갈라지면, 갈라진 쪽을 나중에 찾아낼 방법이 없다.
 */
@Component
@RequiredArgsConstructor
public class LinkDisplayNameChangeListener {

    private final LinkMembershipEventService linkMembershipEventService;

    /**
     * @param event 닉네임 변경 사실
     */
    @EventListener
    public void on(UserDisplayNameChangedEvent event) {
        linkMembershipEventService.recordDisplayNameChanged(event.userId(), event.displayName());
    }
}
