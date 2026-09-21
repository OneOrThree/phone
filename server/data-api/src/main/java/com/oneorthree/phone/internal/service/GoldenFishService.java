package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.construction.service.IslandWalletEvents;
import com.oneorthree.phone.construction.service.IslandWalletService;
import com.oneorthree.phone.focus.repository.FocusRewardAccrualRepository;
import com.oneorthree.phone.focus.repository.FocusRewardPolicyRepository;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.domain.FocusRewardAccrual;
import com.oneorthree.phone.focus.repository.domain.FocusRewardPolicy;
import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.focus.support.GoldenFishDraw;
import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 황금 물고기 추첨·적립·알림 (GROMO-1956) — 같이 집중 보너스의 전부다.
 *
 * <p>기획 정본(policy-2026-09-14.md 「물고기 재화와 기록」)의 다섯 문장이 이 클래스의 계약이다:
 * <ul>
 *   <li><b>섬마다 1분에 한 번</b> 추첨한다. 전역 추첨 뒤 섬을 고르는 것이 아니라 섬마다 독립이다 —
 *       {@code GoldenFishScheduler} 가 후보 섬을 훑고 섬 하나가 자기 트랜잭션으로 돈다.</li>
 *   <li>추첨 순간 그 섬에서 <b>ACTIVE(집중 중, 휴식 제외)인 주민이 2명 이상</b>일 때만 추첨한다.</li>
 *   <li>확률은 인원으로만 정하고 인원은 <b>최대 5명</b>까지 센다 — 값은 전부 서버 정책 설정
 *       ({@link FocusRewardPolicy})이고 코드 상수가 아니다.</li>
 *   <li>당첨되면 <b>섬 잔액에 50마리를 한 번</b> 더한다. 인원수만큼 곱하지 않는다.</li>
 *   <li>50마리는 함께 낚은 주민의 <b>누적 획득 기록과 건설 각자 몫</b>에 {@code 50 ÷ 인원}(내림)씩
 *       나눠 더하고, <b>나머지는 섬 잔액에만</b> 남는다.</li>
 * </ul>
 *
 * <h2>480마리 상한과 별도</h2>
 * 「오늘 480마리 상한을 채운 주민도 ACTIVE이면 인원에 넣고 함께 낚는다. 황금 물고기는 480마리 상한과
 * 별도로 지급하며 자체 상한은 두지 않는다.」 — 그래서 상한을 여기서 보지 않고, 주민 몫도
 * {@code focus_reward_accruals.golden_fish} 라는 <b>다른 열</b>에 넣는다. 상한 합산
 * ({@code sumEarnedFishOnDay})은 {@code earned_fish} 만 읽으므로 두 축이 서로를 깎지 않는다.
 *
 * <h2>멱등 — 재추첨도 중복 적립도 없다</h2>
 * 둘은 다른 문제이고 막는 자리도 다르다.
 * <ul>
 *   <li><b>재추첨</b>: 주사위가 {@code (섬, 분)} 의 순수 함수다({@link GoldenFishDraw}). 틱이 밀리거나
 *       ShedLock 을 놓쳐 같은 분을 다시 돌려도 <b>같은 결과</b>가 나온다.</li>
 *   <li><b>중복 적립</b>: 섬 원장 키 {@code golden:<추첨 분 epoch 초>} 다. 지갑·각자 몫·원장이
 *       {@link IslandWalletService#creditGoldenFish} 의 <b>한 트랜잭션</b>이라, 그 메서드가 원장을 보고
 *       {@code false} 를 돌려주면 이 클래스는 기록도 사건도 쓰지 않는다.
 *       {@code uq_island_wallet_tx_idem} 이 최후 방어선이다. 인메모리 플래그는 없다.</li>
 * </ul>
 *
 * <h2>추첨 순간 휴식·종료로 바뀌는 주민 (티켓 미정 ③ — 여기서 정한다)</h2>
 * <b>확률은 추첨 순간의 스냅샷 인원으로, 배분은 잠금 아래 확정된 인원으로</b> 정한다. 당첨된 뒤에
 * 참여 세션을 전부 배타 잠그고 <b>다시 ACTIVE 인지 확인</b>해 그 집합으로 {@code 50 ÷ 인원} 을 나눈다.
 * 잠근 뒤 2명 미만이 되면 추첨 자체를 무르고 아무것도 적립하지 않는다(「혼자 집중할 때는 나타나지
 * 않는다」). 진 추첨에서는 잠그지 않는다 — 250번 중 249번이 지므로, 지는 추첨까지 매분 전 세션을
 * 잠그면 집중 적립 틱과 쓸데없이 경합한다.
 *
 * <h2>잠금 순서</h2>
 * 세션 상세(sessionId 오름차순) → 섬 건설 상태 → 섬 통장. {@link FocusRewardAccrualService} 의
 * 꼬리(상세 → 건설 상태 → 통장)와 같고, 상세를 <b>전부 잡은 뒤에</b> 아래로 내려가므로 그 틱과
 * 교착 쌍이 되지 않는다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GoldenFishService {

    /** 기획 정본 「ACTIVE 인 주민이 2명 이상일 때만 추첨한다」. */
    public static final int MIN_MEMBERS = 2;

    /** 사건 종류 — 앱이 3초 컷신을 재생하는 신호다(GROMO-1938). realtime 채널은 {@code focus}. */
    public static final String EVENT_TYPE = "focus.golden";

    /** 순서 축 — 섬마다 독립이다(지갑·퀘스트 축과 섞지 않는다). */
    public static final String AGGREGATE_TYPE = "ISLAND_GOLDEN_FISH";

    /** 사람이 일으킨 사건이 아니다 — {@code IslandQuestService.SYSTEM_ACTOR} 와 같은 값. */
    private static final UUID SYSTEM_ACTOR = new UUID(0L, 0L);

    private final FocusSessionDetailRepository details;
    private final FocusRewardPolicyRepository policies;
    private final FocusRewardAccrualRepository accruals;
    private final IslandWalletService wallet;
    private final IslandWalletEvents walletEvents;
    private final OutboxCommandPort outbox;

    /**
     * 섬 하나의 한 분 추첨 — 스케줄러가 섬마다 자기 트랜잭션으로 부른다.
     *
     * @param islandId 추첨할 섬
     * @param minute   추첨 분(초 이하가 잘린 UTC instant). 같은 값으로 다시 불러도 결과가 같다
     * @return 이번 호출이 황금 물고기를 <b>새로</b> 적립했으면 {@code true}
     */
    @Transactional
    public boolean drawAndCredit(UUID islandId, Instant minute) {
        List<UUID> candidates =
                details.findSessionIdsByIslandIdAndLifecycle(islandId, FocusSessionLifecycle.ACTIVE);
        if (candidates.size() < MIN_MEMBERS) {
            return false;
        }
        FocusRewardPolicy policy = policies.findFirstByOrderByRevisionDesc().orElse(null);
        if (policy == null || policy.getGoldenFishReward() <= 0) {
            // 정책 없는 배포에서 값을 지어내 주지 않는다 — 집중 보상 적립과 같은 규율이다.
            return false;
        }
        if (GoldenFishDraw.roll(islandId, minute) >= policy.goldenChancePpm(candidates.size())) {
            return false;
        }

        // 당첨 — 여기서부터 쓴다. 상세를 sessionId 오름차순으로 잠가 잠금 순서를 고정한다.
        List<FocusSessionDetail> caught = new ArrayList<>();
        for (UUID sessionId : candidates.stream().sorted().toList()) {
            details.findBySessionIdForUpdate(sessionId)
                    .filter(detail -> detail.getLifecycle() == FocusSessionLifecycle.ACTIVE
                            && islandId.equals(detail.getIslandId()) && detail.getUserId() != null)
                    .ifPresent(caught::add);
        }
        if (caught.size() < MIN_MEMBERS) {
            // 추첨과 잠금 사이에 휴식·종료로 빠져 혼자 남았다 — 혼자일 때는 나타나지 않는다.
            return false;
        }
        int reward = policy.getGoldenFishReward();
        int share = reward / caught.size();
        List<UUID> memberIds = caught.stream().map(FocusSessionDetail::getUserId)
                .sorted(Comparator.naturalOrder()).toList();
        if (!wallet.creditGoldenFish(islandId, reward, share, memberIds,
                "golden:" + minute.getEpochSecond())) {
            // 같은 추첨이 이미 적립돼 있다 — 기록도 사건도 다시 쓰지 않는다.
            return false;
        }
        if (share > 0) {
            LocalDate day = LocalDate.ofInstant(minute, FocusRewardAccrualService.REWARD_DAY_ZONE);
            for (FocusSessionDetail detail : caught) {
                accruals.findBySessionIdAndAccruedOn(detail.getSessionId(), day)
                        .ifPresentOrElse(row -> row.addGolden(share),
                                () -> accruals.save(FocusRewardAccrual.builder()
                                        .sessionId(detail.getSessionId()).accruedOn(day)
                                        .earnedFish(0).goldenFish(share).build()));
            }
        }
        publish(islandId, minute, reward, share, caught);
        walletEvents.changed(islandId, SYSTEM_ACTOR, "GOLDEN_FISH");
        log.info("황금 물고기 — island={}, minute={}, members={}, reward={}, share={}",
                islandId, minute, caught.size(), reward, share);
        return true;
    }

    /**
     * 참여 주민에게 갈 사건 하나 — 「함께 낚은 주민 모두의 휴대폰에서 … 약 3초 컷신」의 신호다.
     *
     * <p><b>수신자별로 펼치지 않는다.</b> realtime 은 이 사건을 섬의 {@code focus} 채널로 방송하므로,
     * 주민마다 봉투를 적으면 <b>같은 방송이 인원수만큼</b> 나가 앱이 컷신을 여러 번 재생한다. 대신
     * {@code members} 에 함께 낚은 주민을 전부 실어, 앱이 「내가 그 안에 있는가」로 자기 화면을 정한다.
     * 봉투의 {@code userId} 가 시스템 행위자인 것도 그래서다 — 수신자가 아니라 발생 주체다.
     *
     * <p>{@code eventId} 는 {@code golden:<섬>:<분>} 이라 재실행에서 같은 키가 나온다. 이 메서드가
     * 불리는 것은 원장 멱등을 통과한 <b>새 적립</b>일 때뿐이므로 UNIQUE 위반이 나면 그것은 진짜 결함이다.
     */
    private void publish(UUID islandId, Instant minute, int reward, int share,
                         List<FocusSessionDetail> caught) {
        List<Map<String, Object>> members = caught.stream().map(detail -> {
            Map<String, Object> member = new LinkedHashMap<>();
            member.put("userId", detail.getUserId().toString());
            member.put("sessionId", detail.getSessionId().toString());
            return member;
        }).toList();
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("islandId", islandId.toString());
        params.put("drawnAt", minute.toString());
        params.put("reward", reward);
        params.put("sharePerMember", share);
        params.put("members", members);
        outbox.append(new OutboxAppendCommand("golden:" + islandId + ":" + minute.getEpochSecond(), 1,
                EVENT_TYPE, SYSTEM_ACTOR, null, islandId.toString(),
                new AggregateRef(AGGREGATE_TYPE, islandId.toString()), null, params,
                List.of(OutboxDeliveryRequest.toRealtime(EVENT_TYPE, null))));
    }
}
