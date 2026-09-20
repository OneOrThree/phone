package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.construction.service.IslandWalletEvents;
import com.oneorthree.phone.construction.service.IslandWalletService;
import com.oneorthree.phone.focus.repository.FocusRewardAccrualRepository;
import com.oneorthree.phone.focus.repository.FocusRewardPolicyRepository;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.domain.FocusRewardAccrual;
import com.oneorthree.phone.focus.repository.domain.FocusRewardPolicy;
import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.focus.support.FocusIntervalMath;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 집중 보상 적립 (GROMO-1990) — <b>유효 집중 {@code secondsPerFish}(60)초마다 1마리를 섬 통장에</b> 넣는다.
 * 종료(finish)는 추가로 지급하지 않는다: 적립은 진행 중에 이미 끝나 있고, finish 는 그 합을 정산 행에
 * 옮겨 적을 뿐이다. 개인 지갑 적립 경로는 없다(D5-귀속-개정 — 섬 통장 100%, 재화는 섬 단일).
 *
 * <h2>왜 워터마크인가</h2>
 * 틱마다 「지금까지의 순수 집중 초로 나올 수 있는 총 마리 수」에서 <b>이미 판정한 몫</b>
 * ({@code focus_session_details.rewarded_seconds})을 뺀 <b>분들을 하나씩</b> 판정한다. 상한에 걸려 못 받은
 * 몫도 판정 완료로 밀어 둔다 — 그러지 않으면 자정에 상한이 풀리는 순간 어제 깎인 몫이 한꺼번에 터진다.
 * 휴식은 {@code activeSeconds} 에 없으므로(구간 모델) 휴식 중에는 워터마크가 자연히 멈춘다.
 *
 * <h2>왜 분을 접지 않는가</h2>
 * 밀린 분을 한 건으로 접으면 둘이 깨진다: ① 적립 날짜가 「틱이 돈 시각」이 되어 자정 직전에 찬 분이
 * 다음 날 상한을 먹고, 여러 날에 걸쳐 밀렸을 땐 전부 하루 상한 하나로 판정돼 나머지가 소실된다
 * ② 원장에 금액 N 짜리 행 하나만 남아 분 단위 감사 추적이 사라진다(가계부가 조회에서 접는 전제가 깨진다).
 * 그래서 <b>분마다</b> {@link FocusIntervalMath#instantAtActiveSeconds}로 「찬 시각」을 구해 그 날짜의
 * 상한에 걸고, 원장에도 분마다 한 줄을 남긴다.
 *
 * <p>ponytail: 밀린 분 수만큼 도는 순진한 루프다 — 상한에 걸린 분은 DB 를 건드리지 않아 싸지만, 지급되는
 * 분은 원장 한 줄씩이라 정지 시간이 길수록 한 틱이 무거워진다(하루 상한 × 걸친 날짜 수가 상한). 문제가
 * 되면 틱당 분 예산을 두고 남은 분을 다음 틱으로 넘긴다 — 워터마크가 그대로 이어받는다.
 *
 * <h2>멱등</h2>
 * 섬 원장 키는 {@code focus:<sessionId>:<누적 마리 수>} 다. 같은 틱을 다시 돌리면 워터마크가 같으므로
 * 같은 키가 나오고, {@link IslandWalletService#contribute} 가 잠금 아래 재검사로 건너뛴다
 * ({@code uq_island_wallet_tx_idem} 이 최후 방어선). 종전 일괄 정산의 키({@code focus:<sessionId>})와는
 * 접미사가 달라 섞이지 않는다.
 *
 * <h2>잠금 순서</h2>
 * 상세 배타 → 섬 건설 상태 → 섬 통장. 전이(pause/resume/finish)의 순서
 * (사용자 → 섬 → 멤버십 → 상세 → 마커 → 건설 상태 → 통장 → 일 집계)의 <b>꼬리 부분 그대로</b>라
 * 교착 쌍이 생기지 않는다. 그래서 여기서 섬 행·멤버십을 따로 잡지 않는다 — 전이·강퇴와는 상세 행에서
 * 줄을 서고, 강퇴가 이기면 세션이 {@code MEMBERSHIP_LOST} 가 되어 이 틱은 아무것도 하지 않는다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FocusRewardAccrualService {

    /**
     * 하루 상한의 날짜 축 — <b>UTC</b>(결정 D8 · {@code focus-rest-session/policy.md} FR-D01 「하루 상한의
     * 「하루」 경계는 D8(UTC 00:00 리셋)을 따른다」). 일 집계({@code daily_focus_stats})의 KST 축과 다른
     * 것은 의도다: 그쪽은 전환 계획(GROMO-1930) 대기 중인 레거시 축이고, 신규 축은 퀘스트(Q-6)·회관
     * 기록(RC-축)과 같이 처음부터 UTC 다. 축을 바꾸려면 여기 한 곳만 바꾸면 된다.
     */
    public static final ZoneOffset REWARD_DAY_ZONE = ZoneOffset.UTC;

    private final FocusSessionDetailRepository focusSessionDetailRepository;
    private final FocusSessionIntervalRepository focusSessionIntervalRepository;
    private final FocusSessionRepository focusSessionRepository;
    private final FocusRewardPolicyRepository focusRewardPolicyRepository;
    private final FocusRewardAccrualRepository focusRewardAccrualRepository;
    private final IslandWalletService islandWalletService;
    private final IslandWalletEvents islandWalletEvents;
    private final Clock clock;

    /**
     * 한 세션의 적립 틱 — 진행 중(ACTIVE)이 아니면 아무것도 하지 않는다.
     *
     * <p>세션 하나가 자기 트랜잭션으로 돈다(퀘스트 회차 개설·건설 진행과 같은 패턴) — 한 섬의 실패가
     * 다른 섬의 적립을 되돌리지 않게 하기 위해서다.
     *
     * @param sessionId 적립할 세션
     * @return 이번 틱에 섬 통장에 실제로 넣은 마리 수(0 이면 아직 1마리가 안 찼거나 상한이다)
     */
    @Transactional
    public int accrue(UUID sessionId) {
        FocusSessionDetail detail = focusSessionDetailRepository.findBySessionIdForUpdate(sessionId).orElse(null);
        if (detail == null || detail.getLifecycle() != FocusSessionLifecycle.ACTIVE
                || detail.getUserId() == null) {
            return 0;
        }
        // 기본 마커가 바깥에서 닫힌 세션(레거시 start 의 autoCloseOpenMarkersOf)은 사용자에게 이미 끝난
        // 세션이다 — 그런 세션에 물고기를 계속 넣지 않는다. 종결 자체는 수명주기 서비스가 한다.
        if (focusSessionRepository.findEndedAtById(sessionId).isPresent()) {
            return 0;
        }
        FocusRewardPolicy policy = detail.getPolicyRevision() == null ? null
                : focusRewardPolicyRepository.findById(detail.getPolicyRevision()).orElse(null);
        if (policy == null || policy.getSecondsPerFish() <= 0) {
            // 정책 없는 세션은 finish 도 REWARD_POLICY_UNAVAILABLE 로 막는 세션이다 — 값을 지어내 주지 않는다.
            return 0;
        }

        // 물러난 벽시계가 열린 구간을 역전시키지 않게 직전 전이 뒤로 누른다(수명주기 서비스와 같은 규칙).
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        if (detail.getLastTransitionAt() != null && detail.getLastTransitionAt().isAfter(now)) {
            now = detail.getLastTransitionAt();
        }
        List<FocusSessionInterval> intervals =
                focusSessionIntervalRepository.findBySessionIdOrderByOrdinalAsc(sessionId);
        long secondsPerFish = policy.getSecondsPerFish();
        long alreadyJudged = detail.getRewardedSeconds() / secondsPerFish;
        long earnedSoFar = FocusIntervalMath.activeSecondsAsOf(intervals, now) / secondsPerFish;
        if (earnedSoFar <= alreadyJudged) {
            return 0;
        }

        // 분마다 «찬 시각» 으로 날짜를 가르고 그 «날» 의 상한에 건다. 한 번에 N분을 접으면
        // ① 자정 직전에 찬 분이 다음 날 상한을 먹고 ② 밀린 분이 여러 날짜에 걸쳐도 하루 상한 하나로
        // 판정돼 나머지가 워터마크에 밀려 통째로 소실된다.
        Map<LocalDate, Long> usedByDay = new HashMap<>();
        Map<LocalDate, Integer> grantedByDay = new LinkedHashMap<>();
        int granted = 0;
        for (long minute = alreadyJudged + 1; minute <= earnedSoFar; minute++) {
            Instant completedAt =
                    FocusIntervalMath.instantAtActiveSeconds(intervals, now, minute * secondsPerFish);
            if (completedAt == null) {
                break;
            }
            LocalDate day = LocalDate.ofInstant(completedAt, REWARD_DAY_ZONE);
            long used = usedByDay.computeIfAbsent(day, at -> focusRewardAccrualRepository
                    .sumEarnedFishOnDay(detail.getUserId(), detail.getIslandId(), at));
            if (used >= policy.getDailyCapFish()) {
                // 그 «날» 의 상한 — 이 분은 버린다. 다른 날짜의 분은 그대로 나간다(이월도 없다).
                continue;
            }
            usedByDay.put(day, used + 1);
            grantedByDay.merge(day, 1, Integer::sum);
            // 분마다 원장 한 줄 — 밀려서 한 번에 돌아도 감사 추적이 분 단위로 남는다(가계부가 조회에서 접는다).
            // 키가 누적 마리 수라 같은 분은 언제 다시 돌려도 같은 키다.
            islandWalletService.contribute(detail.getIslandId(), detail.getUserId(), 1,
                    "focus:" + sessionId + ":" + minute);
            granted++;
        }
        // 상한으로 깎인 몫도 «판정 완료» 다 — 다음 날로 이월하지 않는다(집중 기록 자체는 그대로 쌓인다).
        detail.markRewarded(earnedSoFar * secondsPerFish);
        if (granted == 0) {
            return 0;
        }

        grantedByDay.forEach((day, fish) -> focusRewardAccrualRepository
                .findBySessionIdAndAccruedOn(sessionId, day)
                .ifPresentOrElse(row -> row.add(fish), () -> focusRewardAccrualRepository.save(
                        FocusRewardAccrual.builder().sessionId(sessionId).accruedOn(day)
                                .earnedFish(fish).build())));
        islandWalletEvents.changed(detail.getIslandId(), detail.getUserId(), "FOCUS_REWARD");
        log.debug("집중 보상 적립 — session={}, user={}, island={}, fish={}, days={}",
                sessionId, detail.getUserId(), detail.getIslandId(), granted, grantedByDay.keySet());
        return granted;
    }
}
