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
import java.util.UUID;

/**
 * 집중 보상 적립 (GROMO-1990) — <b>유효 집중 {@code secondsPerFish}(60)초마다 1마리를 섬 통장에</b> 넣는다.
 * 종료(finish)는 추가로 지급하지 않는다: 적립은 진행 중에 이미 끝나 있고, finish 는 그 합을 정산 행에
 * 옮겨 적을 뿐이다. 개인 지갑 적립 경로는 없다(D5-귀속-개정 — 섬 통장 100%, 재화는 섬 단일).
 *
 * <h2>왜 워터마크인가</h2>
 * 틱마다 「지금까지의 순수 집중 초로 나올 수 있는 총 마리 수」에서 <b>이미 판정한 몫</b>
 * ({@code focus_session_details.rewarded_seconds})을 뺀 만큼만 새로 준다. 상한에 걸려 못 받은 몫도
 * 판정 완료로 밀어 둔다 — 그러지 않으면 자정에 상한이 풀리는 순간 어제 깎인 몫이 한꺼번에 터진다.
 * 휴식은 {@code activeSeconds} 에 없으므로(구간 모델) 휴식 중에는 워터마크가 자연히 멈춘다.
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

        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        long activeSeconds = FocusIntervalMath.activeSecondsAsOf(
                focusSessionIntervalRepository.findBySessionIdOrderByOrdinalAsc(sessionId), now);
        long secondsPerFish = policy.getSecondsPerFish();
        long earnedSoFar = activeSeconds / secondsPerFish;
        long due = earnedSoFar - detail.getRewardedSeconds() / secondsPerFish;
        if (due <= 0) {
            return 0;
        }

        LocalDate day = LocalDate.ofInstant(now, REWARD_DAY_ZONE);
        long alreadyToday = focusRewardAccrualRepository.sumEarnedFishOnDay(
                detail.getUserId(), detail.getIslandId(), day);
        int granted = (int) Math.max(0, Math.min(due, policy.getDailyCapFish() - alreadyToday));
        // 상한으로 깎인 몫도 «판정 완료» 다 — 내일로 이월하지 않는다(집중 기록 자체는 그대로 쌓인다).
        detail.markRewarded(earnedSoFar * secondsPerFish);
        if (granted <= 0) {
            return 0;
        }

        FocusRewardAccrual accrual = focusRewardAccrualRepository
                .findBySessionIdAndAccruedOn(sessionId, day).orElse(null);
        if (accrual == null) {
            focusRewardAccrualRepository.save(FocusRewardAccrual.builder()
                    .sessionId(sessionId).accruedOn(day).earnedFish(granted).build());
        } else {
            accrual.add(granted);
        }
        islandWalletService.contribute(detail.getIslandId(), detail.getUserId(), granted,
                "focus:" + sessionId + ":" + earnedSoFar);
        islandWalletEvents.changed(detail.getIslandId(), detail.getUserId(), "FOCUS_REWARD");
        log.debug("집중 보상 적립 — session={}, user={}, island={}, fish={}, day={}",
                sessionId, detail.getUserId(), detail.getIslandId(), granted, day);
        return granted;
    }
}
