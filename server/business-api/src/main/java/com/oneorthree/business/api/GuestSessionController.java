package com.oneorthree.business.api;

import com.oneorthree.business.auth.AccessTokenVerifier;
import com.oneorthree.business.auth.GuestDeviceCredentials;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.http.ClientIpResolver;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.upstream.data.dto.LoginSession;
import com.oneorthree.business.usecase.AuthSessionUseCase;
import com.oneorthree.business.usecase.GuestSessionUseCase;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;

/**
 * 공개 게스트 시작 — {@code POST /auth/sessions/guest} (GROMO-2036).
 *
 * <p>정책 「인증·게스트 계정」: 게스트도 서버 임시 계정으로 저장한다. 그 계정을 여는 유일한 공개
 * 경로이고, 응답은 소셜 로그인과 <b>같은 201 네 필드</b>다 — 앱의 세션 저장 코드가 로그인이든 게스트든
 * 한 갈래로 끝나게 하기 위해서다.
 *
 * <p>경로가 {@code /auth/sessions/**} 아래인 이유는 {@link SessionRefreshController} 와 같다: 봉투와
 * {@code no-store}, nginx 위성 분기가 설정 변경 없이 따라온다.
 *
 * <h2>AT 를 보냈다면 검증한다</h2>
 * {@code AccessTokenFilter} 가 이 raw method/path 에 한해 AT 생략을 허용하고, 보냈다면 평소처럼
 * 검증한다 — 계정 LLD §2.1 의 「잘못된 AT 를 익명 로그인으로 조용히 강등하지 않는다」가 여기에도
 * 적용된다. 강등하면 폐기된 세션의 AT 를 든 요청이 새 게스트 계정으로 통과한다.
 */
@RestController
@RequiredArgsConstructor
public class GuestSessionController {

    private final GuestSessionUseCase guests;
    private final AccessTokenVerifier verifier;
    private final ClientIpResolver clientIpResolver;
    private final UpstreamConfigProperties properties;

    @PostMapping(GuestDeviceCredentials.PATH)
    @ResponseStatus(HttpStatus.CREATED)
    public AuthSessionUseCase.Result start(HttpServletRequest request, HttpServletResponse response)
            throws IOException {
        // 본문을 받지 않는다 — 자격도 멱등 키도 전부 헤더다. 필터 예외와 «같은» 판정을 다시 확인해
        // 인코딩 변형이 필터를 비껴가고 라우팅에만 걸리는 경로를 여기서 끊는다.
        if (!GuestDeviceCredentials.matches(request) || request.getQueryString() != null
                || request.getContentLengthLong() > 0 || request.getInputStream().read() != -1) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        GuestDeviceCredentials credentials = GuestDeviceCredentials.from(request);
        if (credentials.accessToken() != null && verifier.verify(credentials.accessToken()).isEmpty()) {
            throw new PublicApiException(ApiErrorCode.UNAUTHORIZED, null);
        }
        // IP 는 «Business 가» 판정한다. 이 값 없이 Data 가 내부 호출의 소스 IP 를 보면 모든 게스트가
        // Business 컨테이너 한 주소로 뭉쳐, 레이트리밋이 보호가 아니라 전원 차단으로 동작한다.
        LoginSession session = guests.start(credentials.deviceId().toString(),
                clientIpResolver.resolve(request),
                Deadline.startingNow(properties.getComposition().getDeadline()));
        DeviceBootstrapHeader.set(response, session.deviceBootstrap());
        return AuthSessionUseCase.Result.of(session);
    }
}
