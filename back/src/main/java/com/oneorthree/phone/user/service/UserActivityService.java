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
 * JwtFilter 가 인증 통과 지점마다 호출 — 하루 최대 1 write/유저.
 * <p>판정(needsTouch)과 write(touchLastActive)를 별개 public 메서드로 나눠 호출측이 조합한다 (GROMO-903).
 * 한 클래스 안에서 판정 → @Transactional 메서드로 내부 호출하면 self-invocation 이라 프록시를 안 타
 * @Transactional 이 무효가 되고, 반대로 판정을 @Transactional 메서드 안에 두면 갱신이 필요 없는
 * 요청에서도 트랜잭션이 열려 이 티켓의 절약분이 사라진다.
 * <p>AuthService(585) 는 건드리지 않는다 — 활동 갱신은 이 필터 경로 단일 책임.
 */
@Service
@RequiredArgsConstructor
public class UserActivityService {

    // last_active_at 기준 타임존 고정 — 미접속 복귀 배치의 KST date diff 판정과 통일.
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final UserRepository userRepository;

    /**
     * 저장된 last_active_at 가 오늘(KST) 시작 이전이면 true — 이때만 DB write 가 필요하다 (GROMO-903).
     * 트랜잭션도 DB 왕복도 없다: 호출측이 인증 조회에서 이미 읽어온 값을 그대로 넘기기 때문이다.
     * <p>null 은 true 로 본다 — 컬럼은 NOT NULL 이지만 판정만은 fail-safe 로(한 번 더 쓰는 편이 누락보다 낫다).
     */
    public boolean needsTouch(Instant lastActiveAt, Instant now) {
        return lastActiveAt == null || lastActiveAt.isBefore(startOfTodayKst(now));
    }

    /**
     * last_active_at 를 now 로 갱신한다. 호출측이 needsTouch 로 걸러 그날 첫 요청에만 진입한다.
     * <p>UPDATE 의 WHERE 가드(lastActiveAt &lt; startOfTodayKst)는 그대로 둔다 — 같은 유저의 동시 요청 2건이
     * 둘 다 stale 로 판정되는 레이스의 최종 방어선이다(써도 멱등, 갱신 행은 1개).
     * <p>@Modifying UPDATE 는 트랜잭션이 필요해 필터에서 직접 못 부르므로 @Transactional 서비스로 감싼다.
     */
    @Transactional
    public void touchLastActive(UUID userId, Instant now) {
        userRepository.touchLastActiveAt(userId, now, startOfTodayKst(now));
    }

    private static Instant startOfTodayKst(Instant now) {
        return now.atZone(KST).toLocalDate().atStartOfDay(KST).toInstant();
    }
}
