package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.repository.domain.AuthSession;
import com.oneorthree.phone.auth.service.AuthSessionService;
import com.oneorthree.phone.internal.dto.DeviceSessionVerifyRequest;
import com.oneorthree.phone.internal.dto.DeviceSessionVerifyResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Optional;
import java.util.UUID;

/**
 * 세션 축 내부 표면 — {@code deviceBootstrap} 활성 <b>동기</b> 확인 + fencing (A22 ㋤ · ㋨).
 *
 * <h2>왜 동기 확인인가</h2>
 * 개별 기기 로그아웃은 유저 세대를 올리지 않는다(㊼). 그래서 비동기 폐기 relay 만 두면 그 지연
 * 사이에 도착한 A 의 지연 등록이 <b>아직 미사용인 1회용 자격</b>으로 통과해 B 기기의 토큰 소유권을
 * 되찾아간다.
 *
 * <h2>확인만으로도 부족하다</h2>
 * 통과 직후 로그아웃이 커밋되면 TOCTOU 가 남는다. 그래서 {@code sessionEpoch} 를 함께 주고,
 * 알림 서버가 자기 세션 tombstone 과 <b>원자 대조</b>한 뒤에만 소유권을 바꾼다. 그 값을 위해
 * 조회는 <b>배타 잠금</b>이다 — 무락으로 읽으면 확인과 mutation 이 다른 순서 경계에 놓인다.
 *
 * <p>{@code POST} 인 이유는 자격 문자열을 쿼리에 실으면 접근 로그·프록시 캐시에 남기 때문이다.
 * 상태를 바꾸지 않으므로 재시도는 안전하다.
 */
@RestController
@RequestMapping("/internal/auth")
@RequiredArgsConstructor
public class InternalAuthController {

    private final AuthSessionService authSessionService;

    /**
     * @param userId  {@code X-User-Id} — 남의 세션 자격을 통과시키지 않도록 조회 조건에 함께 들어간다
     * @param request 앱이 실은 1회용 자격
     * @return 활성 여부와 fencing 값. <b>비활성일 때도 마지막 값을 채운다</b> — 그 값이 tombstone
     *     비교의 기준이라, 0 을 주면 이미 끝난 세션의 지연 등록이 「가장 오래된 값」으로 통과한다
     */
    @Transactional
    @PostMapping("/device-sessions/verify")
    public ResponseEntity<DeviceSessionVerifyResponse> verifyDeviceSession(
            @RequestHeader("X-User-Id") UUID userId,
            @Valid @RequestBody DeviceSessionVerifyRequest request) {

        Optional<AuthSession> session =
                authSessionService.verifyBootstrap(userId, request.deviceBootstrap());
        // 자격 자체가 없으면 «활성 아님 + epoch 0» 이다. 이 조합은 「그런 세션이 없다」는 뜻이라,
        // 수신 측은 어떤 소유권 변경도 허용하지 않는다(0 보다 오래된 tombstone 은 존재할 수 없다).
        return ResponseEntity.ok(session
                .map(row -> new DeviceSessionVerifyResponse(row.isActive(), row.getSessionEpoch()))
                .orElseGet(() -> new DeviceSessionVerifyResponse(false, 0L)));
    }
}
