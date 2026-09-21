package com.oneorthree.business.usecase;

import com.oneorthree.business.auth.CredentialDigest;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataApiClient;
import com.oneorthree.business.upstream.data.dto.LoginSession;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 게스트 세션 발급 (GROMO-2036 · 정책 「인증·게스트 계정」).
 *
 * <p>정책: 「게스트도 고양이 선택, 섬 만들기·가입, 집중까지 이용할 수 있다. <b>서버 임시 계정으로
 * 저장</b>해 앱 재실행 후에도 데이터를 유지한다.」 그 임시 계정을 여는 경로가 이것이다.
 *
 * <h2>digest 는 여기서 계산한다</h2>
 * {@link AuthSessionUseCase} 와 같은 규율이다(계정 LLD §3) — 앱이 보낸 digest 를 받지 않고, 매 요청이
 * 원 기기 식별자를 제시하면 Business 가 자기 비밀로 계산한다. Data 는 기기 식별자 원문을 보지 않는다.
 *
 * <h2>게스트 «제한» 은 여기 없다</h2>
 * 친구 요청·편지·구매 차단은 정책상 게스트에게 막히지만 그 판정은 <b>티켓 1992</b> 몫이고, 근거는
 * 이 경로가 발급하는 AT 의 {@code guest=true} 클레임이다 — 발급과 제한을 한 자리에 섞지 않는다.
 */
@Service
@RequiredArgsConstructor
public class GuestSessionUseCase {

    private final DataApiClient data;
    private final CredentialDigest digests;

    /**
     * @param deviceId 정규화된 기기 식별자 UUID 문자열 — 멱등 키다
     * @param clientIp Business 가 신뢰한 프록시에서 판정한 호출자 주소. Data 의 게스트 레이트리밋 축이다
     */
    public LoginSession start(String deviceId, String clientIp, Deadline deadline) {
        LoginSession session;
        try {
            session = data.issueGuestSession(digests.ofDevice(deviceId), clientIp, deadline);
        } catch (UpstreamDomainException e) {
            // 이름이 공개 계약과 달라 GlobalExceptionHandler 의 자동 매핑(ApiErrorCode.valueOf)에
            // 붙지 않는 «유일한» 코드다. 옮겨 적지 않으면 정상적인 대량 생성 차단이 502
            // UPSTREAM_CONTRACT_ERROR 로 나가, 앱이 「서버 장애」로 오해하고 재시도조차 하지 않는다.
            if (e.getStatus() == 429 && "GUEST_CREATION_RATE_LIMITED".equals(e.getCode())) {
                throw new PublicApiException(ApiErrorCode.RATE_LIMITED, null);
            }
            throw e;
        }
        // AuthSessionUseCase.verified 와 같은 판정이다 — 토큰 없는 성공을 그대로 내보내면 앱은
        // 「시작됐다」고 믿고 다음 요청에서 401 을 맞는다.
        if (session == null || session.accessToken() == null || session.accessToken().isBlank()
                || session.refreshToken() == null || session.refreshToken().isBlank()
                || session.userId() == null) {
            throw new UpstreamContractMismatchException("Data 게스트 발급 결과 계약 불일치");
        }
        return session;
    }
}
