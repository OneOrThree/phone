package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.LoginAttemptExecuteRequest;
import com.oneorthree.phone.internal.dto.LoginAttemptLookupRequest;
import com.oneorthree.phone.internal.dto.LoginAttemptLookupResponse;
import com.oneorthree.phone.internal.dto.LoginSessionResponse;
import com.oneorthree.phone.internal.service.LoginAttemptService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 소셜 로그인 세션의 <b>내부 표면</b> (GROMO-1908). 공개 경로가 아니다 — 공개 {@code POST
 * /auth/sessions} 는 Business 의 {@code AuthSessionController} 이고 여기는 그 위임만 받는다
 * ({@link InternalFocusSessionController} 와 같은 결).
 *
 * <h2>경로가 {@code /internal/users/{userId}} 축이 «아닌» 이유</h2>
 * {@code InternalAuthFilter} 는 그 접두어를 보면 경로의 {@code userId} 와 {@code X-User-Id} 헤더의
 * 일치를 강제한다. <b>로그인 전에는 검증된 userId 가 없다</b> — 그게 이 요청으로 알아내려는 값이다.
 * 그래서 주체 없는 {@code /internal/auth/*} 축을 쓴다({@code /internal/auth/sessions/logout} 과 같다).
 *
 * <h2>왜 두 표면인가</h2>
 * LLD §3 은 「제공자 교환 <b>전에</b> 내구 시도를 먼저 조회한다」이고 재생 분기의 「IdP 교환 횟수는
 * 0」이다. 조회와 실행을 나눠 두면 그 0 이 <b>호출 횟수로 관측된다</b> — 하나로 합쳐 내부에서
 * 분기하면 「정말 다시 안 불렀는가」를 밖에서 확인할 수 없고 회귀가 조용히 들어온다.
 *
 * <p>둘 다 {@code POST} 인 이유는 자격 digest 를 쿼리에 실으면 접근 로그·프록시 캐시에 남기 때문이다
 * ({@link InternalAuthController} 와 같은 판단). 조회는 상태를 바꾸지 않아 재시도가 안전하다.
 *
 * <p>응답을 {@code {"data": …}} 로 감싸지 않는다. 그 봉투는 Business 의 {@code ApiResponseAdvice}
 * 몫이고 내부 표면은 알맹이만 돌려준다.
 */
@RestController
@RequestMapping("/internal/auth/login-attempts")
@RequiredArgsConstructor
public class InternalLoginAttemptController {

    private final LoginAttemptService loginAttemptService;

    /** 제공자 교환 전 조회. 부수효과가 없고 제공자를 부르지 않는다. */
    @PostMapping("/lookup")
    public LoginAttemptLookupResponse lookup(@Valid @RequestBody LoginAttemptLookupRequest request) {
        return loginAttemptService.lookup(request);
    }

    /** 실행권을 잡고 제공자 교환까지 수행한다. <b>여기가 IdP 를 부르는 유일한 자리다.</b> */
    @PostMapping
    public LoginSessionResponse execute(@Valid @RequestBody LoginAttemptExecuteRequest request) {
        return loginAttemptService.execute(request);
    }
}
