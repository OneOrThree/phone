package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupChallengeWindowRepository;
import com.oneorthree.phone.group.service.WindowFocusAggregator;
import com.oneorthree.phone.notification.domain.NotificationSentLog;
import com.oneorthree.phone.notification.dto.PushDispatchSummaryResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 창형(TIME_WINDOW) 챌린지의 <b>창 종료 감지 푸시</b>(B4) — 15분 크론.
 *
 * <p>창형 스크린타임은 "창이 끝난 뒤 유저가 앱에 들어와야" 사용분이 올라온다(A4 업로드). 그래서 창이
 * 끝난 직후 "결과를 확인해보세요" 를 보내 복귀를 유도하고, 복귀가 업로드 → 결과 모달로 이어진다.
 * <b>승패는 싣지 않는다</b> — 보고 전이라 아직 확정이 아니다.
 *
 * <p>GROMO-1088 에서 <b>FOCUS 창형까지</b> 대상을 넓혔다. FOCUS 는 서버 데이터라 창이 끝난 순간
 * 결과가 이미 확정이지만, 끝났다는 사실 자체와 결과 모달로 가는 딥링크는 카테고리와 무관하게 필요하다.
 * 타입 문자열은 두 카테고리 모두 {@code CHALLENGE_WINDOW_END} 로 둔다 — 앱의 레거시 딥링크 폴백이
 * 이 문자열에 걸려 있어(구 바이너리 호환, 계약 §2) 창형이 여기서 이탈하면 폴백이 죽는다.
 *
 * <p>창은 매일 반복되는 시간대다(계약 §설계 보정). 날짜 D 의 실제 창 경계는
 * {@link WindowFocusAggregator#windowEndOn} 이 유일한 소스이며(진행률·정산과 같은 해석),
 * 자정을 걸치는 창은 D 시작 ~ D+1 종료로 전개된다. 그래서 감지 후보 날짜를 어제·오늘 둘로 잡는다.
 *
 * <p>감지 이후(그룹원 조회·dedup·발송·이력 기록)는 {@link ChallengeEndPushDispatcher} 가 맡는다 —
 * 일 마감 푸시({@link ChallengeDurationEndNotificationService})와 같은 규칙을 쓰기 위함이다.
 *
 * <p>dedup: (user_id, type={@code CHALLENGE_WINDOW_END}, target_user_id={@code challengeId}) +
 * <b>당일(KST) sent_at</b>(단, 감지 폭만큼은 자정 너머까지 — {@link #dedupSince} 참고).
 * 매일 반복되는 창이라 날짜를 끊지 않으면 이튿날 발송까지 막힌다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ChallengeWindowEndNotificationService {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    /** 푸시 종류 식별자 — 앱이 data.type 으로 읽어 딥링크 폴백·GA4 push_opened 에 쓴다(계약 §2). */
    static final String PUSH_TYPE = NotificationSentLog.TYPE_CHALLENGE_WINDOW_END;

    /** 승패 미포함 문구(계약 §2) — 보고 전이라 결과가 확정되지 않았다. */
    static final ChallengeEndPushDispatcher.PushCopy PUSH_COPY =
            new ChallengeEndPushDispatcher.PushCopy("챌린지가 끝났어요!", "결과를 확인해보세요");

    /**
     * "방금 끝났다" 로 보는 폭 — 크론 주기(15분)보다 넉넉하게 잡는다. 배포·재기동으로 한 틱을 걸러도
     * 다음 틱이 주워 담게 하려는 것이고, 넓혀서 생기는 중복 발송은 dedup 이 막는다(늦어도 30분 내 발송).
     */
    static final Duration RECENTLY_ENDED_WINDOW = Duration.ofMinutes(30);

    private final GroupChallengeRepository groupChallengeRepository;
    private final GroupChallengeWindowRepository groupChallengeWindowRepository;
    private final WindowFocusAggregator windowFocusAggregator;
    private final ChallengeEndPushDispatcher challengeEndPushDispatcher;

    /** 스케줄러(15분 간격)·수동 트리거 진입점. */
    public PushDispatchSummaryResponse sendWindowEndNotifications() {
        return sendWindowEndNotifications(Instant.now());
    }

    /**
     * 창 종료 감지 푸시 본체.
     *
     * <p>무효 토큰 정리(더티체킹)가 일어나므로 쓰기 트랜잭션 안에서 돈다.
     */
    @Transactional
    public PushDispatchSummaryResponse sendWindowEndNotifications(Instant now) {
        long startedAtMillis = System.currentTimeMillis();
        List<GroupChallenge> challenges = groupChallengeRepository.findActiveByType(
                GroupChallengeStatus.ACTIVE, MissionType.TIME_WINDOW);
        if (challenges.isEmpty()) {
            return summary(startedAtMillis);
        }

        Map<UUID, GroupChallengeWindow> windowsByChallengeId = groupChallengeWindowRepository
                .findByChallengeIdIn(challenges.stream().map(GroupChallenge::getId).toList())
                .stream()
                .collect(Collectors.toMap(GroupChallengeWindow::getChallengeId, Function.identity()));
        List<GroupChallenge> justEnded = challenges.stream()
                .filter(challenge -> hasJustEnded(windowsByChallengeId.get(challenge.getId()), now))
                .toList();
        if (justEnded.isEmpty()) {
            return summary(startedAtMillis);
        }

        PushDispatchSummaryResponse summary = challengeEndPushDispatcher.dispatch(
                justEnded, PUSH_TYPE, PUSH_COPY, dedupSince(now), now, startedAtMillis);
        log.info("창 종료 푸시 완료 — 종료 챌린지 {}건, 대상 {}건, 발송 {}건, dedup {}건, 스킵 {}건, "
                        + "elapsedMillis={}",
                justEnded.size(), summary.targetCount(), summary.sentCount(), summary.dedupedCount(),
                summary.skippedCount(), summary.elapsedMillis());
        return summary;
    }

    /**
     * 오늘(KST) 창 종료가 방금 지났는지. 자정을 걸치는 창은 어제 시작분의 종료가 오늘 새벽이므로
     * 어제·오늘 두 날짜를 모두 후보로 본다. 경계는 {@code (now - 폭, now]} — 종료 시각 정각은 포함이다.
     */
    private boolean hasJustEnded(GroupChallengeWindow window, Instant now) {
        if (window == null) {
            // V20 이전 창 챌린지에도 상세 행은 있으므로 정상 흐름에선 나오지 않는다(방어).
            return false;
        }
        LocalDate today = LocalDate.ofInstant(now, KST);
        Instant since = now.minus(RECENTLY_ENDED_WINDOW);
        return List.of(today.minusDays(1), today).stream()
                .map(date -> windowFocusAggregator.windowEndOn(date, window))
                .anyMatch(end -> end.isAfter(since) && !end.isAfter(now));
    }

    /**
     * 발송 이력을 어디까지 거슬러 볼지 — 당일(KST) 00:00 이되, <b>감지 폭만큼은 자정 너머까지</b> 본다.
     *
     * <p>하나의 창 종료는 감지 폭(30분)이 크론 주기(15분)보다 넓어 보통 연속 두 틱에 걸쳐 잡히는데,
     * 종료 시각이 23:30~24:00 이면 그 두 틱이 자정을 사이에 두고 하루씩 갈린다 — 당일 00:00 으로만
     * 끊으면 자정 뒤 틱이 자정 전에 남긴 기록을 못 보고 <b>전원에게 두 번</b> 보낸다(@claude 리뷰 지적).
     * 창은 매일 반복이라 직전 발생은 24시간 전이므로, 30분을 더 거슬러 올라가도 어제 발송분을 오늘
     * dedup 으로 잘못 집는 일은 없다.
     */
    private Instant dedupSince(Instant now) {
        Instant startOfTodayKst = LocalDate.ofInstant(now, KST).atStartOfDay(KST).toInstant();
        Instant detectionFloor = now.minus(RECENTLY_ENDED_WINDOW);
        return detectionFloor.isBefore(startOfTodayKst) ? detectionFloor : startOfTodayKst;
    }

    /** 대상 0건 요약 — 감지 단계에서 끝난 경우. */
    private PushDispatchSummaryResponse summary(long startedAtMillis) {
        return new PushDispatchSummaryResponse(
                0, 0, 0, 0, System.currentTimeMillis() - startedAtMillis);
    }
}
