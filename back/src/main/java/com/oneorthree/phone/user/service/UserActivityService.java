package com.oneorthree.phone.user.service;

import com.oneorthree.phone.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.ZoneId;
import java.util.UUID;

/**
 * 유저 마지막 활동 시각(last_active_at) 갱신 (GROMO-578).
 * JwtFilter 가 인증 통과 지점마다 호출 — 하루 최대 1 write/유저로 스로틀(WHERE 가드).
 * <p>@Modifying UPDATE 는 트랜잭션이 필요해 필터에서 직접 못 부르므로 @Transactional 서비스로 감싼다.
 * AuthService(585) 는 건드리지 않는다 — 활동 갱신은 이 필터 경로 단일 책임.
 */
@Service
@RequiredArgsConstructor
public class UserActivityService {

    // last_active_at 기준 타임존 고정 — 미접속 복귀 배치의 KST date diff 판정과 통일.
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final UserRepository userRepository;

    /**
     * 저장된 last_active_at 가 오늘(KST) 시작 이전이면 now 로 갱신한다.
     * 스로틀 가드는 UPDATE 의 WHERE 절에 있어 오늘 이미 갱신된 유저는 0건 매치(무쓰기)로 끝난다.
     * <p>TODO(트래픽 증가 시): 매 인증요청마다 트랜잭션 UPDATE 1회가 붙는다. WHERE 가드로 하루 1회만
     * 실제 write 되지만, 오늘 이미 갱신된 유저도 0건 매치를 확인하려 쿼리 왕복(트랜잭션 begin/commit 포함)은
     * 매번 발생한다. 지금 트래픽엔 급하지 않아 트래킹만 — 부하가 커지면 유저별 "오늘 갱신함" 인메모리 스로틀
     * 캐시(TTL=자정까지)로 DB 왕복 자체를 건너뛰는 후속 최적화를 검토한다.
     */
    @Transactional
    public void touchLastActive(UUID userId, Instant now) {
        Instant startOfTodayKst = now.atZone(KST).toLocalDate().atStartOfDay(KST).toInstant();
        userRepository.touchLastActiveAt(userId, now, startOfTodayKst);
    }
}
