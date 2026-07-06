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
     */
    @Transactional
    public void touchLastActive(UUID userId, Instant now) {
        Instant startOfTodayKst = now.atZone(KST).toLocalDate().atStartOfDay(KST).toInstant();
        userRepository.touchLastActiveAt(userId, now, startOfTodayKst);
    }
}
