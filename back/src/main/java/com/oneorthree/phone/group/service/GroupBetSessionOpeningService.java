package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

/**
 * 회차 자동 개설(N35 일부 — GROMO-1411 배치) — "개설"이라는 유저 행위는 소멸했고(GROMO-1262),
 * 내기가 켜진 챌린지의 활성일 회차는 시스템이 보증한다. 00:05 정규 개설과 매시 캐치업 보증 스캔이
 * 같은 {@link #ensureSession} 을 지난다(스케줄 배선: {@code GroupBetScheduler}).
 *
 * <p><b>개설 4경로 공통 조건(N35)</b>: 활성 요일 + 참가 가능 시각. 참가 마감(창형 = 창 시작,
 * 하루형 = 회차 종료)이 이미 지난 날짜는 개설하지 않는다 — 캐치업이 늦게 돌아도 참가할 수 없는
 * 죽은 회차를 세우지 않는다(마감 지난 창형은 오늘 스킵).
 *
 * <p>챌린지 생성 시 당일 개설(N35 나머지)과 join-next 의 lazy 개설은 B5 와 공유한다 —
 * {@link #ensureSession} 이 그 공용 진입점이다.
 *
 * <p>⚠️ <b>활성 요일(repeat_days) 게이트는 B1 스택 합류 시 배선된다</b> — 이 브랜치 base 에는
 * B1 의 {@code RepeatSchedule}·{@code repeat_days} 가 없어 매일 활성으로 동작한다(현행 스키마와
 * 동치). {@link #activeOn} 단일 지점만 바꾸면 되도록 이음새를 고정해 둔다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GroupBetSessionOpeningService {

    private final GroupChallengeRepository groupChallengeRepository;
    private final GroupChallengeBetRepository groupChallengeBetRepository;
    private final GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    private final GroupBetJudge groupBetJudge;
    private final GroupBetSessionFactory groupBetSessionFactory;

    // 보증 스캔 루프는 GroupBetScheduler 에 있다 — 같은 빈에서 ensureSession 을 돌리면 자기
    // 호출(self-invocation)이라 @Transactional 프록시를 타지 않아 잠금 쿼리가
    // TransactionRequiredException 으로 터진다(스캔은 건별 트랜잭션 격리도 필요하다).

    /**
     * 회차 개설 단일 진입점(공용 — B5 join-next·챌린지 생성 당일 개설도 이 메서드를 부른다).
     * 조건 미충족(비활성 요일·참가 마감 경과·내기 미설정)이면 empty, 이미 있으면 기존 회차를
     * 돌려준다(UPSERT 의미 — {@code UNIQUE (bet_id, session_date)} 가 최후 방어).
     *
     * <p>챌린지 행 배타 락으로 삭제({@code deleteChallenge})·레거시 개설과 직렬화한다 — 락이 없으면
     * "OPEN 회차 무효화가 끝났다"고 본 삭제와 이 개설이 겹쳐, 참가 가능한 회차가 삭제된 챌린지에
     * 매달린다.
     */
    @Transactional
    public Optional<GroupChallengeBetSession> ensureSession(UUID challengeId, LocalDate date) {
        GroupChallenge challenge = groupChallengeRepository
                .findByIdAndDeletedAtIsNullForUpdate(challengeId).orElse(null);
        if (challenge == null || challenge.getStatus() != GroupChallengeStatus.ACTIVE) {
            return Optional.empty();
        }
        if (!activeOn(challenge, date)) {
            return Optional.empty();
        }
        GroupChallengeBet bet = groupChallengeBetRepository.findByChallengeId(challengeId)
                .filter(GroupChallengeBet::isEnabled)
                .orElse(null);
        if (bet == null) {
            return Optional.empty();
        }
        // 목표를 모르면 판정·정산이 불가 — 내기 대상이 아니다(레거시 개설 게이트와 동일).
        Optional<GroupBetJudge.Target> target = groupBetJudge.resolve(challenge);
        if (target.isEmpty()) {
            return Optional.empty();
        }
        // 참가 가능 시각 게이트(N35) — 마감 지난 창형은 오늘 스킵(내일 스캔이 다시 세운다).
        if (!Instant.now().isBefore(groupBetSessionFactory.joinClosesAtOn(target.get(), date))) {
            return Optional.empty();
        }

        Optional<GroupChallengeBetSession> existing =
                groupChallengeBetSessionRepository.findByBetIdAndSessionDate(bet.getId(), date);
        if (existing.isPresent()) {
            return existing;
        }
        try {
            GroupChallengeBetSession session = groupChallengeBetSessionRepository.saveAndFlush(
                    groupBetSessionFactory.create(
                            bet, challenge.getGroup(), challenge, target.get(), date));
            log.info("회차 자동 개설 — sessionId={}, challengeId={}, date={}, stake={}",
                    session.getId(), challengeId, date, session.getStake());
            return Optional.of(session);
        } catch (DataIntegrityViolationException e) {
            // 사전 검사와 동시 개설(레거시 브리지 등)이 겹친 레이스 — 유니크가 막았으니 기존 행이 정답.
            return groupChallengeBetSessionRepository.findByBetIdAndSessionDate(bet.getId(), date);
        }
    }

    /**
     * 활성 요일 게이트(N35) — <b>B1 배선 이음새</b>. B1 의 {@code RepeatSchedule.activeOn(mask, date)}
     * 가 이 자리에 들어온다. 현행 스키마에는 반복 요일이 없어 매일 활성이다.
     */
    private boolean activeOn(GroupChallenge challenge, LocalDate date) {
        // TODO(B1 스택 합류): RepeatSchedule.activeOn(challenge.getRepeatDays(), date) 로 교체.
        return true;
    }
}
