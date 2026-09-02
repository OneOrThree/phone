package com.oneorthree.phone.user.service;

import com.oneorthree.phone.user.repository.UserRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

/**
 * 유저 마지막 활동 시각(last_active_at) 갱신 (GROMO-578).
 * JwtFilter 가 인증 통과 지점마다 호출 — 마지막 갱신 후 touchInterval 이 지났을 때만 1 write.
 * <p>스로틀 기준은 "슬라이딩 창"이지 "달력 하루"가 아니다 (GROMO-903). 원래는 KST 자정 경계였으나
 * 글로벌 서비스에서 특정 국가 자정을 전 유저의 하루 경계로 쓸 수 없고, 애초에 스로틀은 "얼마나 자주 쓸까"의
 * 문제라 "어느 날에 속하나"(=소비자인 미접속 복귀 배치의 관심사)와 섞을 이유가 없다. 이 클래스에서
 * 타임존을 들어내 날짜 정책을 소비자 한 곳으로 모은다.
 * <p><b>소비자 주의</b>: 그 대가로 last_active_at 은 실제 마지막 활동보다 최대 touchInterval 만큼 과거일 수
 * 있다. 자정 직후 창 안에 그날 첫 활동을 한 유저는 값이 전날로 남아 "정확히 N일째" 판정이 하루 당겨진다.
 * <p>판정(needsTouch)과 write(touchLastActive)를 별개 public 메서드로 나눠 호출측이 조합한다.
 * 한 클래스 안에서 판정 → {@code @Transactional} 메서드로 내부 호출하면 self-invocation 이라 프록시를 안 타
 * {@code @Transactional} 이 무효가 되고, 반대로 판정을 {@code @Transactional} 메서드 안에 두면 갱신이 필요 없는
 * 요청에서도 트랜잭션이 열려 이 티켓의 절약분이 사라진다.
 * <p>AuthService(585) 는 건드리지 않는다 — 활동 갱신은 이 필터 경로 단일 책임.
 */
@Service
public class UserActivityService {

    private final UserRepository userRepository;

    /**
     * 같은 유저에게 write 를 허용하는 최소 간격. 짧을수록 last_active_at 이 정확해지고 write 가 늘어난다.
     * 공통 application.yml 은 gitignored 라 배포 환경에 안 실린다 — 값은 application-dev/prod.yml 에 둔다.
     */
    private final Duration touchInterval;

    /**
     * @param userRepository 갱신을 수행할 리포지토리
     * @param touchInterval  같은 유저에게 write 를 허용하는 최소 간격. 프로퍼티 미설정 시 2시간이며,
     *                       공통 application.yml 이 배포에 실리지 않으므로 환경별 파일에 값을 둬야 한다
     */
    public UserActivityService(
            UserRepository userRepository,
            @Value("${app.user-activity.touch-interval:2h}") Duration touchInterval) {
        this.userRepository = userRepository;
        this.touchInterval = touchInterval;
    }

    /**
     * 마지막 갱신 후 touchInterval 이 지났으면 true — 이때만 DB write 가 필요하다 (GROMO-903).
     * 트랜잭션도 DB 왕복도 없다: 호출측이 인증 조회에서 이미 읽어온 값을 그대로 넘기기 때문이다.
     * <p>null 은 true 로 본다 — 컬럼은 NOT NULL 이지만 판정만은 fail-safe 로(한 번 더 쓰는 편이 누락보다 낫다).
     *
     * @param lastActiveAt 인증 조회에서 이미 읽어온 값. 여기서 DB 를 다시 보지 않는다
     * @param now          이번 요청의 기준 시각
     * @return 갱신이 필요하면 true. 이 판정만 통과했다고 write 가 보장되지는 않는다 —
     *         UPDATE 쪽 WHERE 가드가 동시 요청의 중복 write 를 다시 한 번 거른다
     */
    public boolean needsTouch(Instant lastActiveAt, Instant now) {
        return lastActiveAt == null || lastActiveAt.isBefore(now.minus(touchInterval));
    }

    /**
     * last_active_at 를 now 로 갱신한다. 호출측이 needsTouch 로 걸러 창당 1회만 진입한다.
     * <p>UPDATE 의 WHERE 가드(lastActiveAt &lt; staleBefore)는 그대로 둔다 — 같은 유저의 동시 요청 2건이
     * 둘 다 stale 로 판정되는 레이스의 최종 방어선이다(써도 멱등, 갱신 행은 1개).
     * <p>@Modifying UPDATE 는 트랜잭션이 필요해 필터에서 직접 못 부르므로 @Transactional 서비스로 감싼다.
     *
     * @param userId 갱신 대상
     * @param now    기록할 활동 시각. 스로틀 하한({@code now - touchInterval})도 여기서 파생된다
     */
    @Transactional
    public void touchLastActive(UUID userId, Instant now) {
        userRepository.touchLastActiveAt(userId, now, now.minus(touchInterval));
    }
}
