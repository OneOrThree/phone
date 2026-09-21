package com.oneorthree.business.usecase;

import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataApiClient;
import com.oneorthree.business.upstream.data.dto.SessionRefresh;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * AT 재발급 (GROMO-2035, 계정 LLD §3 「refresh와 세션 마이그레이션」).
 *
 * <h2>회전하지 않는다</h2>
 * LLD §3 「정상 RT 회전의 클라이언트 전환 gate」: 서버는 원자 credential bundle 전환이 검증되지 않은
 * 클라이언트에 정상 RT 회전을 활성화하지 않고, 호환 경로는 <b>미회전 응답 {@code refreshToken:null}</b>
 * 을 쓴다. 2.0 앱은 아직 그 gate 를 통과하지 않았다 — 판정은 Data 가 하고 여기서는 상류가 준 값을
 * 그대로 싣는다. 여기서 null 로 «만들면» 회전이 켜지는 날 앱이 이미 죽은 RT 를 붙들게 된다.
 *
 * <h2>실패는 셋 다 같은 401 이다</h2>
 * 만료·위조·이미 교체된 RT 는 LLD §3 표의 {@code 401 REFRESH_TOKEN} 하나로 모인다. 원인을 쪼개면
 * 「어느 검증에서 걸렸는가」를 공격자에게 알려 주고, 앱의 답은 어느 쪽이든 재로그인으로 같다.
 */
@Service
@RequiredArgsConstructor
public class SessionRefreshUseCase {

    private final DataApiClient data;

    /**
     * <p>상류 실패를 <b>손으로 옮겨 적지 않는다</b>. Data 의 {@code 401 REFRESH_TOKEN} ·
     * {@code 404 USER_NOT_FOUND} 는 공개 계약과 이름이 같아 {@code GlobalExceptionHandler} 가
     * 이름+상태로 매핑한다. 여기에 같은 매핑을 한 벌 더 두면 상류가 상태를 바꿨을 때 자동 매핑은
     * 502 로 끊는데 손으로 적은 쪽만 옛 코드를 계속 내보내, <b>두 벌이 어긋난다</b>.
     */
    public Result refresh(String refreshToken, Deadline deadline) {
        SessionRefresh refreshed = data.refreshSession(refreshToken, deadline);
        // 토큰 없는 200 을 그대로 내보내면 앱은 「갱신됐다」고 믿고 저장소에 빈 값을 쓴 뒤 다음
        // 요청에서 401 을 맞는다 — 그 시점엔 원인이 갱신이라는 사실이 보이지 않는다. 502 로 올린다.
        if (refreshed == null || refreshed.accessToken() == null || refreshed.accessToken().isBlank()) {
            throw new UpstreamContractMismatchException("Data 갱신 결과 계약 불일치");
        }
        return new Result(refreshed.accessToken(), refreshed.refreshToken());
    }

    /**
     * 공개 200 의 두 필드.
     *
     * @param refreshToken 회전이 일어났을 때만 채워진다. 현재 이 경로는 <b>언제나 null</b> 이고, 앱은
     *                     값이 있을 때만 저장소를 갱신한다. 필드를 빼지 않는 이유는 회전이 활성화될 때
     *                     <b>필드의 유무가 아니라 값</b>만 달라지게 하기 위해서다
     */
    public record Result(String accessToken, String refreshToken) {

        @Override
        public String toString() {
            return "Result[tokens=redacted]";
        }
    }
}
