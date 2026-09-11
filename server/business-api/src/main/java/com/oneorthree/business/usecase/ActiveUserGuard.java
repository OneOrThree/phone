package com.oneorthree.business.usecase;

import com.oneorthree.business.common.exception.CommonErrorCode;
import com.oneorthree.business.common.exception.DomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataApiClient;
import com.oneorthree.business.upstream.data.dto.UserActivation;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * <b>위성 쓰기 전 활성 검사</b> (A22 ⓖ · §5). 위성으로 직행하는 쓰기는 Data 의 {@code X-User-Id} 활성
 * 검사를 안 거치므로, 이 관문이 없으면 탈퇴 직전 발급된 AT 로 최대 AT 수명 동안 기기 토큰을 재등록하고
 * 초대를 귀속시킬 수 있다.
 *
 * <p><b>읽기에는 걸지 않는다</b> — §5 는 「읽기 전용 경로는 AT 3600s 창 수용」이라고 못 박았다. 읽기에도
 * 걸면 Data 호출이 두 배가 되고, 그 대가로 막는 것은 탈퇴자가 자기 설정을 보는 것뿐이다.
 *
 * <p><b>판정 불가를 「비활성」으로 접지 않는다.</b> Data 장애 때 거부로 접으면 전원이 조용히 차단되고,
 * 기기 토큰·설정은 앱이 실패를 삼켜 영구 유실이 된다 — {@code UpstreamUnavailableException} 이 그대로
 * 503 으로 올라가게 둔다.
 */
@Component
@RequiredArgsConstructor
public class ActiveUserGuard {

    private final DataApiClient dataApiClient;

    /**
     * @throws DomainException 탈퇴·비활성 사용자면 {@code USER_INACTIVE}(401)
     */
    public void requireActive(UUID userId, Deadline deadline) {
        UserActivation activation = dataApiClient.checkActivation(userId, deadline);
        if (activation == null || !activation.active()) {
            throw new DomainException(CommonErrorCode.USER_INACTIVE);
        }
    }
}
