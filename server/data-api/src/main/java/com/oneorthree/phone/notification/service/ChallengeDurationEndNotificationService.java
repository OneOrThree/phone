package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.repository.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.repository.domain.MissionType;
import com.oneorthree.phone.group.repository.domain.RepeatSchedule;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.notification.repository.domain.NotificationSentLog;
import com.oneorthree.phone.notification.dto.PushDispatchSummaryResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 일 목표형(DURATION) 챌린지의 <b>하루 마감 푸시</b>(GROMO-1088) — 매일 09:00 KST 1회.
 *
 * <p>창형이 아닌 챌린지는 종료 시각이 따로 없다. DURATION 은 "하루 누적 목표"라 한 회차가
 * <b>자정(KST)</b>에 끝난다(진행률·정산이 모두 KST 하루 경계를 쓴다). 그래서 감지는 시각 비교가 아니라
 * "어제 회차가 끝났다" 는 사실 하나이고, 발송만 시각을 골라 미룬다.
 *
 * <p><b>09:00 KST 인 이유</b>:
 * <ul>
 *   <li>자정 직후는 기본 조용한 시간(23–07)이라 전원이 필터에서 잘린다(지연 발송 없음 — 스펙 확정),</li>
 *   <li>08:00 은 종전 내기 결과 푸시 크론이 쓰던 시각이다(현재는 사건 단위 파이프라인
 *       {@link BetEventNotificationService} 의 15분 재훑기로 대체 — GROMO-1417),</li>
 *   <li>스크린타임 내기 정산(12:00)보다 앞서므로, 이 푸시로 복귀한 유저의 어제치 스크린타임 업로드가
 *       정산 전에 반영된다 — "미보고=미달성" 억울 패배를 오히려 줄인다.</li>
 * </ul>
 *
 * <p>타입은 {@code CHALLENGE_ENDED}(계약 §1). 창형이 쓰는 {@code CHALLENGE_WINDOW_END} 와 나눠 두는
 * 이유는 앱의 레거시 딥링크 폴백이 창형 문자열에 걸려 있기 때문이다(계약 §2). dedup 은 창형과 같은
 * (user_id, type, target_user_id=challengeId) 이고, 회차 경계가 자정이라 이력 조회는 어제 회차가 끝난
 * 시각(= 오늘 00:00 KST) 이후만 본다 — 그 전의 기록은 전부 <b>다른 회차</b>다.
 *
 * <p>감지 이후(그룹원 조회·dedup·발송·이력 기록)는 {@link ChallengeEndPushDispatcher} 가 맡는다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ChallengeDurationEndNotificationService {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    /** 푸시 종류 식별자 — 앱이 data.type 으로 읽어 GA4 push_opened 를 가른다(계약 §1·§2). */
    static final String PUSH_TYPE = NotificationSentLog.TYPE_CHALLENGE_ENDED;

    /**
     * 상세(일 목표) 조회의 {@code IN} 절 크기 상한.
     *
     * <p>대상이 <b>활성 DURATION 챌린지 전건</b>이라, 그룹 수가 늘면 바인드 목록이 그대로 커져
     * 드라이버·DB 한도에 걸리거나 쿼리 비용이 급증해 09:00 배치가 발송 전에 죽는다(@codex 리뷰).
     * 발송 청크(그룹 200)와 축이 달라 별도 상수로 둔다 — 이쪽은 챌린지 id 기준이다.
     */
    static final int DETAIL_CHUNK_SIZE = 500;

    /**
     * 승패 미포함 문구 — 스크린타임 일 목표는 어제치 최종 보고가 아직 안 올라왔을 수 있고(A4 업로드),
     * 포커스도 결과 표시는 앱의 결과 모달 몫이다.
     */
    static final ChallengeEndPushDispatcher.PushCopy PUSH_COPY =
            new ChallengeEndPushDispatcher.PushCopy("챌린지가 끝났어요!", "어제 목표 달성 결과를 확인해보세요");

    private final GroupChallengeRepository groupChallengeRepository;
    private final GroupChallengeDurationRepository groupChallengeDurationRepository;
    private final ChallengeEndPushDispatcher challengeEndPushDispatcher;

    /**
     * 스케줄러(매일 09:00 KST)·수동 트리거 진입점.
     *
     * <p>여기에도 {@code @Transactional} 이 필요하다 — 아래 오버로드를 같은 객체에서 직접 부르면
     * Spring 프록시를 지나지 않아 그쪽 애노테이션이 적용되지 않는다. 트랜잭션이 안 열리면 조회로
     * 올라온 {@code User} 가 분리 상태라 무효 토큰 정리(더티체킹)가 저장되지 않고, 다음 크론마다
     * 같은 무효 토큰으로 FCM 을 계속 호출한다(@codex 리뷰).
     *
     * @return 이번 실행의 발송 요약(현재 시각 기준)
     */
    @Transactional
    public PushDispatchSummaryResponse sendDurationEndNotifications() {
        return sendDurationEndNotifications(Instant.now());
    }

    /**
     * 하루 마감 푸시 본체 — 직전 회차(어제, KST)가 끝난 일 목표형 챌린지가 대상이다.
     *
     * <p>무효 토큰 정리(더티체킹)가 일어나므로 쓰기 트랜잭션 안에서 돈다.
     *
     * @param now 어느 회차를 "직전"으로 볼지 정하는 기준 시각(KST 로 환산해 어제를 고른다)
     * @return 이번 실행의 발송 요약. 대상 챌린지가 없으면 전부 0 인 요약이 그대로 나온다
     */
    @Transactional
    public PushDispatchSummaryResponse sendDurationEndNotifications(Instant now) {
        long startedAtMillis = System.currentTimeMillis();
        List<GroupChallenge> challenges = groupChallengeRepository.findActiveByType(
                GroupChallengeStatus.ACTIVE, MissionType.DURATION);
        if (challenges.isEmpty()) {
            return summary(startedAtMillis);
        }

        // 목표(일 목표 분)가 없는 챌린지는 결과 자체가 없다 — 진행률 계산 대상 판정과 같은 기준이다.
        Set<UUID> withGoal = findChallengeIdsWithGoal(
                challenges.stream().map(GroupChallenge::getId).toList());
        Instant cycleEnd = cycleEnd(now);
        // 직전 회차일(어제, KST) — 비활성 요일엔 회차가 서지 않았으므로 마감 알림도 없다(FR-9 · §A3).
        LocalDate cycleDate = LocalDate.ofInstant(cycleEnd, KST).minusDays(1);
        List<GroupChallenge> ended = challenges.stream()
                .filter(challenge -> RepeatSchedule.activeOn(challenge.getRepeatDays(), cycleDate))
                .filter(challenge -> withGoal.contains(challenge.getId()))
                .filter(challenge -> hasFinishedCycle(challenge, cycleEnd))
                .toList();
        if (ended.isEmpty()) {
            return summary(startedAtMillis);
        }

        // 회차 종료 = 자정(KST), 발송 = 09:00 — 그 사이 가입한 멤버는 어제 회차에 참여한 적이 없다.
        Map<UUID, Instant> cycleEndByChallengeId = ended.stream()
                .collect(Collectors.toMap(GroupChallenge::getId, challenge -> cycleEnd));
        PushDispatchSummaryResponse summary = challengeEndPushDispatcher.dispatch(
                ended, PUSH_TYPE, PUSH_COPY, cycleEnd, cycleEndByChallengeId, now, startedAtMillis);
        log.info("일 목표 챌린지 마감 푸시 완료 — 마감 회차 {}, 대상 챌린지 {}건, 대상 {}건, 발송 {}건, "
                        + "dedup {}건, 스킵 {}건, elapsedMillis={}",
                LocalDate.ofInstant(cycleEnd, KST).minusDays(1), ended.size(), summary.targetCount(),
                summary.sentCount(), summary.dedupedCount(), summary.skippedCount(),
                summary.elapsedMillis());
        return summary;
    }

    /**
     * 직전 회차가 끝난 시각 — 오늘(KST) 00:00. 어제 회차의 마감선이자 dedup 이력 조회의 하한이다
     * (이 시각 이전의 기록은 전부 그 이전 회차의 것이다).
     */
    private Instant cycleEnd(Instant now) {
        return LocalDate.ofInstant(now, KST).atStartOfDay(KST).toInstant();
    }

    /**
     * 어제 회차를 실제로 겪은 챌린지인가 — 회차가 끝난 뒤(오늘) 만들어진 챌린지는 알릴 결과가 없다.
     * 회차 도중에 만들어진 챌린지는 그날의 일 목표를 그대로 갖는 것으로 본다(카드 진행률과 같은 해석).
     */
    private boolean hasFinishedCycle(GroupChallenge challenge, Instant cycleEnd) {
        Instant createdAt = challenge.getCreatedAt();
        return createdAt == null || createdAt.isBefore(cycleEnd);
    }

    /** 목표(일 목표 분)가 설정된 챌린지 id — {@code IN} 절을 {@link #DETAIL_CHUNK_SIZE} 로 잘라 조회한다. */
    private Set<UUID> findChallengeIdsWithGoal(List<UUID> challengeIds) {
        Set<UUID> withGoal = new HashSet<>();
        for (int from = 0; from < challengeIds.size(); from += DETAIL_CHUNK_SIZE) {
            List<UUID> chunk =
                    challengeIds.subList(from, Math.min(from + DETAIL_CHUNK_SIZE, challengeIds.size()));
            groupChallengeDurationRepository.findByChallengeIdIn(chunk).stream()
                    .map(GroupChallengeDuration::getChallengeId)
                    .forEach(withGoal::add);
        }
        return withGoal;
    }

    /** 대상 0건 요약 — 감지 단계에서 끝난 경우. */
    private PushDispatchSummaryResponse summary(long startedAtMillis) {
        return new PushDispatchSummaryResponse(
                0, 0, 0, 0, System.currentTimeMillis() - startedAtMillis);
    }
}
