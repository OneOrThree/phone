package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBet;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.repository.domain.RepeatSchedule;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.support.GroupBetSessionFactory;
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
     * 개설 결과 — 회차와 <b>이번 호출이 실제로 만들었는지</b>.
     *
     * @param session 보장된 회차(신규 또는 기존)
     * @param created true 면 이번 호출의 INSERT 다. 기존 회차를 돌려준 경우 false
     */
    public record SessionOpening(GroupChallengeBetSession session, boolean created) {
    }

    /**
     * 회차 개설 단일 진입점(공용 — B5 join-next·챌린지 생성 당일 개설도 이 메서드를 부른다).
     * 조건 미충족(비활성 요일·참가 마감 경과·내기 미설정)이면 empty, 이미 있으면 기존 회차를
     * 돌려준다(UPSERT 의미 — {@code UNIQUE (bet_id, session_date)} 가 최후 방어).
      *
      * @param challengeId 회차를 세울 챌린지 — 삭제됐거나 ACTIVE 가 아니면 아무 일도 하지 않는다
      * @param date 회차 날짜(KST)
      * @return 보장된 회차. 비활성 요일·참가 마감 경과·내기 미설정이면 empty 이며, 이는 실패가 아니라
      *     「그날 열 회차가 없다」는 뜻이다
     */
    @Transactional
    public Optional<GroupChallengeBetSession> ensureSession(UUID challengeId, LocalDate date) {
        return openSession(challengeId, date).map(SessionOpening::session);
    }

    /**
     * {@link #ensureSession} 과 같은 보장을 하되 <b>신규 개설 여부까지</b> 돌려준다 — 캐치업 스캔이
     * "이번 틱이 실제로 몇 건을 세웠나"를 세려면 기존 회차와 구분해야 한다(멱등 스캔이라 기존 회차를
     * 신규로 세면 개설 장애 감시 지표가 항상 양수라 무의미해진다).
     *
     * <p>챌린지 행 배타 락으로 삭제({@code deleteChallenge})·레거시 개설과 직렬화한다 — 락이 없으면
     * "OPEN 회차 무효화가 끝났다"고 본 삭제와 이 개설이 겹쳐, 참가 가능한 회차가 삭제된 챌린지에
     * 매달린다.
      *
      * @param challengeId 회차를 세울 챌린지 — 이 행을 배타 락으로 잡아 삭제·레거시 개설과 직렬화한다
      * @param date 회차 날짜(KST)
      * @return 회차와 이번 호출이 실제로 INSERT 했는지. 동시 개설에 졌으면 상대가 만든 회차를
      *     {@code created=false} 로 돌려준다. 열 조건이 아니면 empty
     */
    @Transactional
    public Optional<SessionOpening> openSession(UUID challengeId, LocalDate date) {
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
            return existing.map(session -> new SessionOpening(session, false));
        }
        try {
            GroupChallengeBetSession session = groupChallengeBetSessionRepository.saveAndFlush(
                    groupBetSessionFactory.create(
                            bet, challenge.getGroup(), challenge, target.get(), date));
            log.info("회차 자동 개설 — sessionId={}, challengeId={}, date={}, stake={}",
                    session.getId(), challengeId, date, session.getStake());
            return Optional.of(new SessionOpening(session, true));
        } catch (DataIntegrityViolationException e) {
            // 사전 검사와 동시 개설(레거시 브리지 등)이 겹친 레이스 — 유니크가 막았으니 기존 행이 정답.
            // 이 경우 INSERT 를 성사시킨 쪽은 상대이므로 created=false 다.
            return groupChallengeBetSessionRepository.findByBetIdAndSessionDate(bet.getId(), date)
                    .map(session -> new SessionOpening(session, false));
        }
    }

    /**
     * 활성 요일 게이트(N35) — 챌린지의 반복 요일 비트마스크(V34, GROMO-1405)로 판정한다.
     *
     * <p>이 판정이 없으면 <b>쉬는 요일에도 OPEN 회차가 선다</b>. 회차가 서면 요일을 보지 않는
     * 레거시 참가 경로({@code GroupBetService.joinBet})가 그 회차에 참가비까지 걸 수 있어 돈이
     * 잘못 묶인다 — 개설 게이트가 그 경로의 유일한 방어선이다.
     */
    private boolean activeOn(GroupChallenge challenge, LocalDate date) {
        return RepeatSchedule.activeOn(challenge.getRepeatDays(), date);
    }
}
