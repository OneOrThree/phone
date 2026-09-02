package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

/**
 * 참가비 동결 감지(B4 ops) — 정산 배치가 조용히 죽어 <b>에스크로된 참가비가 묶여 있는</b> 상태를
 * 드러낸다. 재편(GROMO-1262) 후 감시 단위는 <b>회차</b>다.
 *
 * <p>회차는 참가 즉시 참가비가 차감(에스크로)되고 정산에서야 풀린다. 그래서 정산이 실패·누락되면
 * 유저 돈이 사라진 것처럼 보이는데, 배치 자체가 안 돌면 실패 로그조차 안 남아 아무도 모른다.
 * 하루에 한 번 "정산됐어야 할 나이"의 OPEN 회차를 세어 남는 것이 있으면 error 로 남긴다.
 *
 * <p>임계: {@code session_date ≤ 오늘 − 2}. 어제 회차는 오늘 01:00·12:00 배치의 대상이라 아직
 * 정상이고, 그제 것이 OPEN 이면 배치가 최소 한 번은 걸렀다는 뜻이다(≈ 24h 이상 동결).
 *
 * <p>관리자 푸시·슬랙 연동은 범위 밖 — 로그 고정 포맷으로 알림 규칙을 걸 수 있게 하는 데까지다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GroupBetFreezeMonitor {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    /** 동결로 보는 나이(일) — session_date 가 오늘 − 이 값 이하면 정산 기회를 이미 놓친 것이다. */
    static final int FROZEN_AGE_DAYS = 2;

    /** 로그에 실을 sessionId 상한 — 대량 동결 시 로그 한 줄이 무한정 길어지지 않게 자른다. */
    static final int LOGGED_BET_ID_LIMIT = 20;

    private final GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;

    /**
     * 스케줄러(09:00 KST) 진입점.
     *
     * @return 동결로 판정된 OPEN 회차 수(0 이면 정상). 알림의 정본은 이 값이 아니라 error 로그다
     */
    public int detectFrozenBets() {
        return detectFrozenBets(Instant.now());
    }

    /**
     * @param now 기준 시각 — 여기서 뽑은 KST 날짜가 동결 임계의 원점이다. 테스트가 날짜를 밀어
     *     넣을 수 있도록 열어 둔 축이라 운영에서는 항상 현재 시각이 들어온다
     * @return 동결로 판정된 OPEN 회차 수(0 이면 정상)
     */
    @Transactional(readOnly = true)
    public int detectFrozenBets(Instant now) {
        LocalDate today = LocalDate.ofInstant(now, KST);
        // findIdsByStatusAndSessionDateBefore 는 session_date < beforeDate 라, 오늘−1 을 주면
        // session_date ≤ 오늘−2 다.
        List<UUID> frozen = groupChallengeBetSessionRepository.findIdsByStatusAndSessionDateBefore(
                GroupBetStatus.OPEN, today.minusDays(FROZEN_AGE_DAYS - 1L));
        if (frozen.isEmpty()) {
            log.info("참가비 동결 감지 — 없음 (기준일 {})", today);
            return 0;
        }
        log.error("참가비 24h 이상 동결 — 미정산 OPEN 회차 {}건, sessionIds={}{}",
                frozen.size(),
                frozen.stream().limit(LOGGED_BET_ID_LIMIT).toList(),
                frozen.size() > LOGGED_BET_ID_LIMIT ? " (앞 " + LOGGED_BET_ID_LIMIT + "건만 표시)" : "");
        return frozen.size();
    }
}
