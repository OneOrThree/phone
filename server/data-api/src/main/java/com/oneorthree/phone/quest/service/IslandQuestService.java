package com.oneorthree.phone.quest.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.oneorthree.phone.construction.repository.IslandFacilityRepository;
import com.oneorthree.phone.construction.repository.domain.ConstructionBuilding;
import com.oneorthree.phone.construction.service.IslandWalletEvents;
import com.oneorthree.phone.construction.service.IslandWalletService;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.group.service.GroupMembershipMutationLocks;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.PublicCommandRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandResult;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.outbox.service.PublicCommandService;
import com.oneorthree.phone.outbox.support.OutboxEnvelopeCodec;
import com.oneorthree.phone.quest.dto.QuestViews;
import com.oneorthree.phone.quest.exception.QuestErrorCode;
import com.oneorthree.phone.quest.exception.QuestException;
import com.oneorthree.phone.quest.repository.IslandQuestClaimRepository;
import com.oneorthree.phone.quest.repository.IslandQuestOccurrenceRepository;
import com.oneorthree.phone.quest.repository.IslandQuestRepository;
import com.oneorthree.phone.quest.repository.domain.IslandQuest;
import com.oneorthree.phone.quest.repository.domain.IslandQuestClaim;
import com.oneorthree.phone.quest.repository.domain.IslandQuestOccurrence;
import com.oneorthree.phone.quest.repository.domain.QuestType;
import com.oneorthree.phone.user.repository.UserQueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * 섬 퀘스트 5계약의 Data 측 구현 (GROMO-1773, island-quests LLD §1~§6).
 *
 * <p><b>잠금 순서</b>(LLD §5): 사용자(users 배타) → receipt 선점({@link PublicCommandService}) → 섬(groups
 * 배타) → 회차 → 섬 통장 → outbox version. 건설 명령(… 섬 → 건설 상태 → 지갑)과 집중 finish(… 섬 → 상세 →
 * 건설 상태 → 지갑)도 «섬 먼저, 지갑 마지막»이라 서로를 거꾸로 기다리지 않는다. 회차 행은 이 서비스만 잠근다.
 *
 * <p><b>수령</b>(GROMO-1991): 개인 달성분은 주민이 «받기»를 눌러 각자 받고({@link #claim}), 전원 달성
 * 보너스는 <b>수령과 독립으로</b> 매분 finalizer 가 한 번 적립한다({@link #settleBonusIfAllAchieved}) —
 * 기획 정본 {@code policy-2026-09-14.md} 「일일 퀘스트와 보상」의 «전원 달성 시 … 즉시 지급한다».
 *
 * <p><b>출시 스위치</b>(policy.md 출시 조건): 새 생산 데이터를 만드는 생성과 정산(claim)은 각각
 * {@code island-quest.creation-enabled}·{@code island-quest.settlement-enabled} 로 닫혀 있다(기본 false).
 * 조회·수정은 열려 있다 — 생성이 닫혀 있으면 수정할 정의도 없다.
 *
 * <p><b>날짜 축은 UTC</b>(2026-09-19 결정 Q-6) — 회차는 UTC 자정에 시작하고 창 시각도 UTC 다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class IslandQuestService {

    /**
     * 사람이 부르지 않은 사건의 주체 — 작성자가 계정을 탈퇴해 {@code created_by} 가 끊긴 퀘스트의 회차 개설
     * (GROMO-1952)과, 수령과 독립으로 도는 전원 달성 보너스 정산(GROMO-1991)이 이것을 쓴다. 봉투의 userId 는
     * 필수이고 FK 가 없으며, 이 사건은 섬 전체 방송이라 특정 사용자에게 가지 않는다.
     */
    static final UUID SYSTEM_ACTOR = new UUID(0L, 0L);

    private static final int TITLE_MAX = 40;
    private static final int TARGET_MAX_MINUTES = 1440;
    private static final Pattern HH_MM = Pattern.compile("\\d{2}:\\d{2}");
    private static final DateTimeFormatter WINDOW_FORMAT =
            DateTimeFormatter.ofPattern("HH:mm").withResolverStyle(ResolverStyle.STRICT);

    private final UserQueryService users;
    private final GroupQueryService groups;
    private final GroupMemberRepository members;
    private final GroupMembershipMutationLocks membershipLocks;
    private final IslandFacilityRepository facilities;
    private final IslandQuestRepository quests;
    private final IslandQuestOccurrenceRepository occurrences;
    private final IslandQuestClaimRepository claims;
    private final IslandQuestJudge judge;
    private final IslandQuestEvents questEvents;
    private final IslandWalletService wallet;
    private final IslandWalletEvents walletEvents;
    private final PublicCommandService publicCommands;
    private final Clock clock;

    @Value("${island-quest.creation-enabled:false}")
    private boolean creationEnabled;

    @Value("${island-quest.settlement-enabled:false}")
    private boolean settlementEnabled;

    /** D5 개인 달성 +10 — 달성한 주민이 «받기»를 누르면 받는 몫이다(설정 값, QQ05 revision 등록은 미결). */
    @Value("${island-quest.reward.per-achiever:10}")
    private int rewardPerAchiever;

    /** D5 전원 달성 보너스 1인당 5 — 전원 달성 순간 «대상 주민 수 × 5» 가 수령 없이 적립된다. */
    @Value("${island-quest.reward.all-achieved-bonus-per-member:5}")
    private int rewardBonusPerMember;

    // ---------------------------------------------------------------- 조회

    /**
     * 현재 회차 목록 — 어제·오늘 회차 중 아직 닫히지 않은 것({@link IslandQuestOccurrence#claimDeadline}).
     * 한 스냅샷(REPEATABLE READ)에서 회차·cohort·측정을 읽는다. GET 은 판정만 하고 정산하지 않는다.
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public QuestViews.Current current(UUID islandId, UUID userId) {
        requireReader(islandId, userId);
        Instant now = clock.instant();
        LocalDate today = LocalDate.ofInstant(now, ZoneOffset.UTC);
        List<QuestViews.Item> items = new ArrayList<>();
        for (IslandQuestOccurrence occurrence : occurrences
                .findByIslandIdAndOccurrenceDateBetweenOrderByOccurrenceDateAscCreatedAtAsc(
                        islandId, today.minusDays(1), today)) {
            if (now.isBefore(occurrence.claimDeadline())) {
                items.add(header(occurrence, judge.judge(occurrence, now), userId, claimers(occurrence)));
            }
        }
        return new QuestViews.Current(items);
    }

    /** 회차 진행 — 헤더와 판정 대상 전원. 경로의 섬·퀘스트와 회차가 어긋나거나 지난 회차면 404. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public QuestViews.Progress progress(UUID islandId, UUID userId, UUID questId, UUID occurrenceId) {
        requireReader(islandId, userId);
        requireQuest(islandId, questId);
        Instant now = clock.instant();
        IslandQuestOccurrence occurrence = occurrences.findById(occurrenceId)
                .filter(o -> o.getQuestId().equals(questId) && o.getIslandId().equals(islandId))
                .filter(o -> now.isBefore(o.claimDeadline()))
                .orElseThrow(() -> new QuestException(QuestErrorCode.QUEST_OCCURRENCE_NOT_FOUND));
        IslandQuestJudge.Judgement judgement = judge.judge(occurrence, now);
        List<UUID> claimers = claimers(occurrence);
        List<QuestViews.Member> list = judgement.rows().stream()
                .map(r -> new QuestViews.Member(r.userId(), r.name(), r.rate(), r.measurementStatus(),
                        r.achieved(), claimers.contains(r.userId())))
                .toList();
        return new QuestViews.Progress(header(occurrence, judgement, userId, claimers), list, null);
    }

    // ---------------------------------------------------------------- 생성·수정

    /**
     * 퀘스트 생성 — 방장만(D3). 정의를 저장하고 <b>오늘(UTC) 회차를 즉시</b> 연다 — cohort 는 지금 이 순간의
     * 활성 주민이다. 다음 날부터는 {@link #openTodayIfMissing} 이 UTC 자정마다 연다.
     */
    @Transactional
    public QuestViews.Created create(UUID islandId, UUID userId, String rawTitle, String rawType,
                                     Integer targetMinutes, String rawWindowStart, String rawWindowEnd,
                                     String timezone, UUID idempotencyKey) {
        if (!creationEnabled) {
            throw new QuestException(QuestErrorCode.QUEST_CREATION_UNAVAILABLE);
        }
        requireTimezone(timezone);
        QuestType type = QuestType.fromWire(rawType)
                .orElseThrow(() -> new QuestException(QuestErrorCode.QUEST_INVALID_REQUEST));
        requireSupported(type);
        String title = title(rawTitle);
        int target = target(targetMinutes);
        LocalTime windowStart = null;
        LocalTime windowEnd = null;
        if (type == QuestType.FOCUS) {
            windowStart = windowTime(rawWindowStart);
            windowEnd = windowTime(rawWindowEnd);
            if (!windowStart.isBefore(windowEnd)) {
                throw new QuestException(QuestErrorCode.QUEST_WINDOW_OUT_OF_RANGE);
            }
            requireTargetFits(target, windowStart, windowEnd);
        } else if (rawWindowStart != null || rawWindowEnd != null) {
            throw new QuestException(QuestErrorCode.QUEST_INVALID_REQUEST);
        }

        Map<String, Object> fingerprint = new LinkedHashMap<>();
        fingerprint.put("title", title);
        fingerprint.put("type", type.wire());
        fingerprint.put("targetMinutes", target);
        fingerprint.put("windowStart", rawWindowStart);
        fingerprint.put("windowEnd", rawWindowEnd);
        final LocalTime start = windowStart;
        final LocalTime end = windowEnd;
        JsonNode data = publicCommands.run(
                new PublicCommandRequest(userId, "POST:/islands/" + islandId + "/quests", idempotencyKey,
                        tree(fingerprint)),
                () -> users.getCallerForUpdate(userId),
                ignored -> requireOwnerWriter(islandId, userId),
                () -> {
                    users.getCallerForUpdate(userId);
                    requireOwnerWriter(islandId, userId);
                    IslandQuest quest = quests.save(IslandQuest.builder()
                            .islandId(islandId).type(type).title(title).targetMinutes(target)
                            .windowStart(start).windowEnd(end).createdBy(userId).build());
                    EventEnvelope opened = open(quest, LocalDate.ofInstant(clock.instant(), ZoneOffset.UTC),
                            userId);
                    return new PublicCommandResult(201, tree(new QuestViews.Created(quest.getId(), title)),
                            tree(List.of(opened)));
                }).value().data();
        return decode(data, QuestViews.Created.class);
    }

    /**
     * 정의 수정 — 방장만(D3). 넘긴 필드만 바꾸고 revision 을 올린다. <b>열린 회차는 그대로</b>이고 다음
     * 회차부터 적용된다(결정 Q-4) — 그래서 진행 사건을 내지 않는다.
     */
    @Transactional
    public QuestViews.Updated update(UUID islandId, UUID userId, UUID questId, String rawTitle,
                                     Integer targetMinutes, UUID idempotencyKey) {
        if (rawTitle == null && targetMinutes == null) {
            throw new QuestException(QuestErrorCode.QUEST_INVALID_REQUEST);
        }
        String title = rawTitle == null ? null : title(rawTitle);
        Integer target = targetMinutes == null ? null : target(targetMinutes);
        Map<String, Object> fingerprint = new LinkedHashMap<>();
        fingerprint.put("title", title);
        fingerprint.put("targetMinutes", target);
        JsonNode data = publicCommands.run(
                new PublicCommandRequest(userId, "PATCH:/islands/" + islandId + "/quests/" + questId,
                        idempotencyKey, tree(fingerprint)),
                () -> users.getCallerForUpdate(userId),
                ignored -> requireOwnerWriter(islandId, userId),
                () -> {
                    users.getCallerForUpdate(userId);
                    requireOwnerWriter(islandId, userId);
                    IslandQuest quest = requireQuest(islandId, questId);
                    requireSupported(quest.getType());
                    if (target != null && quest.getType() == QuestType.FOCUS) {
                        requireTargetFits(target, quest.getWindowStart(), quest.getWindowEnd());
                    }
                    quest.revise(title, target);
                    return new PublicCommandResult(200, tree(new QuestViews.Updated(quest.getId(),
                            quest.getTitle(), quest.getTargetMinutes())), tree(List.of()));
                }).value().data();
        return decode(data, QuestViews.Updated.class);
    }

    // ---------------------------------------------------------------- 정산

    /**
     * 개인 수령 — 달성한 주민이 «받기»를 눌러 자기 몫을 받는다(GROMO-1991). 기획 정본 「일일 퀘스트와 보상」:
     * «주민 한 명 달성 시 보상받기 모달을 띄우고, 본인이 받기를 누르면 섬에 물고기 10마리를 지급한다»,
     * «전원 달성 시 대상 주민 수 × 5마리를 즉시 지급한다». 대신 받아 주는 길은 없다 — 주체는 서명된 세션이고
     * 판정도 그 주체의 행으로만 한다. 적립처는 둘 다 섬 통장이다(결정 Q-1).
     *
     * <p>순서(LLD §5): 같은 키 완료 receipt 는 멱등 계층이 먼저 원 결과를 재생한다 → 섬 잠금 → 회차 잠금 →
     * 수령 기한 지남이면 409 STATE_CONFLICT → 이미 받았으면 409 → expectedVersion 불일치 409
     * VERSION_CONFLICT → 내 판정이 미달성·측정 대기·분모 밖이면 409 → 내 claim 행(도메인 유일) → 섬 통장 적립 →
     * (전원 달성이고 아직이면) 보너스 행·적립 → quest.progress.updated·wallet.updated. 어느 단계 실패도 전부
     * 롤백한다.
     *
     * <p>보너스는 <b>수령과 독립</b>이다({@link #settleBonusIfAllAchieved}) — 여기서 함께 적립하는 것은
     * 「마지막 달성자가 곧바로 받기를 눌렀을 때」의 지연을 없애는 지름길일 뿐, 보너스의 책임자는 매분
     * finalizer 다. 둘 다 같은 {@link #settleBonusIfDue} 를 회차 잠금 아래서 부르므로 1회가 유지된다.
     */
    @Transactional
    public QuestViews.Claimed claim(UUID islandId, UUID userId, UUID questId, UUID occurrenceId,
                                    long expectedVersion, UUID idempotencyKey) {
        if (!settlementEnabled) {
            throw new QuestException(QuestErrorCode.QUEST_SETTLEMENT_UNAVAILABLE);
        }
        JsonNode data = publicCommands.run(
                new PublicCommandRequest(userId, "POST:/islands/" + islandId + "/quests/" + questId + "/claims",
                        idempotencyKey, tree(Map.of("occurrenceId", occurrenceId.toString(),
                                "expectedVersion", expectedVersion))),
                () -> users.getCallerForUpdate(userId),
                ignored -> requireResidentWriter(islandId, userId),
                () -> {
                    users.getCallerForUpdate(userId);
                    requireResidentWriter(islandId, userId);
                    requireQuest(islandId, questId);
                    IslandQuestOccurrence occurrence = occurrences.findByIdForUpdate(occurrenceId)
                            .filter(o -> o.getQuestId().equals(questId) && o.getIslandId().equals(islandId))
                            .orElseThrow(() -> new QuestException(QuestErrorCode.QUEST_OCCURRENCE_NOT_FOUND));
                    Instant now = clock.instant();
                    if (!now.isBefore(occurrence.claimDeadline())) {
                        throw new QuestException(QuestErrorCode.QUEST_STATE_CONFLICT);
                    }
                    if (claimers(occurrence).contains(userId)) {
                        // 「각 주민의 달성 보상은 한 번만」(기획 정본) — 다른 멱등키로 두 번 눌러도 여기서 멈춘다.
                        // 버전보다 먼저 본다: 두 번 누른 사람에게 「이미 받았다」가 「버전이 낡았다」보다 맞다.
                        throw new QuestException(QuestErrorCode.QUEST_STATE_CONFLICT);
                    }
                    if (expectedVersion != occurrence.getVersion()) {
                        throw new QuestException(QuestErrorCode.QUEST_VERSION_CONFLICT);
                    }
                    IslandQuestJudge.Judgement judgement = judge.judge(occurrence, now);
                    if (judgement.rowOf(userId).filter(r -> r.counted() && r.achieved()).isEmpty()) {
                        throw new QuestException(QuestErrorCode.QUEST_STATE_CONFLICT);
                    }
                    if (occurrence.getRewardPerAchiever() <= 0 || occurrence.getRewardBonusPerMember() <= 0) {
                        // 0마리 성공으로 미설정을 숨기지 않는다(QQ05) — 배포 구성 오류다.
                        throw new IllegalStateException("퀘스트 보상 설정이 0 입니다.");
                    }
                    int amount = occurrence.getRewardPerAchiever();
                    UUID claimId = credit(occurrence, IslandQuestClaim.KIND_ACHIEVER, amount, userId,
                            "quest:" + occurrence.getId() + ":" + userId);
                    // 내 수령으로 마지막 미달성자가 사라진 것은 아니지만(달성은 수령보다 먼저다), 마지막
                    // 달성자가 곧바로 누른 경우 여기서 이미 전원 달성이라 finalizer 를 기다릴 필요가 없다.
                    int bonus = settleBonusIfDue(occurrence, judgement, now);
                    EventEnvelope progress = questEvents.progressUpdated(occurrence, userId);
                    occurrence.progressed(progress.version());
                    EventEnvelope walletUpdated = walletEvents.changed(islandId, userId, "QUEST_SETTLEMENT");
                    return new PublicCommandResult(200,
                            tree(new QuestViews.Claimed(claimId, occurrence.getId(), amount, bonus, true)),
                            tree(List.of(progress, walletUpdated)));
                }).value().data();
        return decode(data, QuestViews.Claimed.class);
    }

    /**
     * 전원 달성 보너스 finalizer (GROMO-1991) — <b>수령과 독립</b>으로 「대상 주민 수 × 5」를 1회 적립한다.
     * 스케줄러가 회차마다 자기 트랜잭션으로 부른다({@link com.oneorthree.phone.quest.scheduler.IslandQuestScheduler}).
     *
     * <p><b>왜 writer 가 아니라 틱인가</b> — 달성 여부는 저장되지 않고 {@link IslandQuestJudge} 가 매번
     * 계산하는 파생값이다. 그 입력 다섯 중 <b>하나는 writer 가 아예 없다</b>: 열린 ACTIVE 구간을 가진 주민은
     * 아무도 아무것도 쓰지 않는 동안 <b>시계가 흐르는 것만으로</b> 목표를 넘는다. 나머지 넷(활성 멤버십 ·
     * cohort 행 · 활성 계정 · 집중 구간)에 훅을 다 걸어도 그 한 경로가 남으므로, 경로마다 훅을 거는 길은
     * 완결되지 않는다. 그래서 「전원 달성이 성립하는 순간」의 해상도는 <b>틱 간격(1분)</b>으로 정한다 —
     * 집중 보상 적립(GROMO-1990)이 「60초마다」로 잡은 해상도와 같다.
     *
     * <p><b>cohort 기준 시점은 「적립하는 그 순간」의 분모</b>다 — 회차 시작 시점이 아니다. 결정 Q-3 이
     * 「탈퇴·강퇴·계정 탈퇴·측정 불가 주민은 분모에서 뺀다」고 정했고 {@link IslandQuestJudge} 가 매 판정마다
     * 그 교집합을 다시 잡으므로, 화면이 보여 주던 {@code bonusAmount}(같은 판정의 분모)와 실제 적립량이
     * 어긋나지 않는 유일한 선택이다. 적립 뒤 분모가 늘거나 줄어도 다시 계산하지 않는다(회차당 1회).
     *
     * <p>멱등은 기존 세 겹 그대로다 — 회차 행 배타 잠금 · {@code bonus_settled_at} · 지갑 원장 유일키
     * {@code uq_island_wallet_tx_idem}(키 {@code quest-bonus:<회차>}). 새 장치는 없다.
     *
     * <p>잠금 순서는 수령과 같다(LLD §5 의 꼬리): 섬 → 회차 → 섬 통장. 사용자·receipt 를 잡지 않을 뿐이라
     * 수령·강퇴와 거꾸로 기다리지 않는다.
     *
     * <p><b>마감 경계</b>(codex 2R): 정산은 수령 마감보다 한 틱 늦게 닫히고
     * ({@link IslandQuestOccurrence#bonusSettleDeadline()}), 마감을 넘긴 그 틱은 {@code now} 가 아니라
     * <b>마감 시각</b>으로 판정한다. 마지막 틱과 마감 사이에 미달성 주민이 빠져 성립한 전원 달성을
     * 놓치지 않으면서, 마감 뒤로 흐른 시계가 새 달성을 만들지는 못하게 하는 경계다.
     *
     * @return 이번에 적립한 보너스(조건 미달·이미 적립·정산 마감 지남이면 0)
     */
    @Transactional
    public int settleBonusIfAllAchieved(UUID occurrenceId) {
        if (!settlementEnabled) {
            return 0;
        }
        // 엔티티가 아니라 섬 id 만 읽는다 — findById 로 먼저 읽으면 그 인스턴스가 영속성 컨텍스트에 남아
        // 아래 findByIdForUpdate 가 «잠금 전» 스냅샷을 돌려주고, 그 사이 수령 TX 가 적립한 보너스를
        // 못 본 채 두 번째 행을 쓰게 된다.
        UUID islandId = occurrences.findIslandIdById(occurrenceId).orElse(null);
        if (islandId == null) {
            return 0;
        }
        membershipLocks.lockGroup(islandId);
        if (!isAlive(groups.getGroup(islandId))) {
            return 0;
        }
        IslandQuestOccurrence occurrence = occurrences.findByIdForUpdate(occurrenceId).orElse(null);
        if (occurrence == null || occurrence.isBonusSettled()) {
            return 0;
        }
        Instant now = clock.instant();
        Instant deadline = occurrence.claimDeadline();
        if (now.isAfter(occurrence.bonusSettleDeadline())) {
            // 조회·수령은 마감에 닫히지만(LLD §6 과거 없음) 정산은 한 틱 더 연다 — 마지막 틱과 마감 사이에
            // 성립한 전원 달성을 볼 틱이 그것뿐이기 때문이다(근거는 bonusSettleDeadline javadoc).
            return 0;
        }
        // 판정 시각은 마감을 넘지 않는다: 마감 뒤 틱은 「마감 직전 상태를 뒤늦게 보는 것」이지
        // 마감 뒤로 흐른 시계로 새 달성을 만드는 것이 아니다(열린 집중 구간이 마감 뒤까지 자라지 않는다).
        // 적립 시각(bonus_settled_at)은 실제로 적립한 now 다 — 판정 시각과 다른 축이다.
        Instant judgedAt = now.isBefore(deadline) ? now : deadline;
        int bonus = settleBonusIfDue(occurrence, judge.judge(occurrence, judgedAt), now);
        if (bonus == 0) {
            return 0;
        }
        EventEnvelope progress = questEvents.progressUpdated(occurrence, SYSTEM_ACTOR);
        occurrence.progressed(progress.version());
        walletEvents.changed(islandId, SYSTEM_ACTOR, "QUEST_SETTLEMENT");
        return bonus;
    }

    /**
     * 전원 달성 보너스 적립 — 회차당 1회다. 호출측이 <b>회차 행을 배타 잠근</b> 상태여야 하고, 판정은
     * 호출측이 같은 잠금 아래서 만든 것을 받는다(보너스 총액이 화면의 {@code bonusAmount} 와 같아야 한다).
     *
     * @return 이번에 적립한 보너스(전원 달성이 아니거나 이미 적립됐으면 0)
     */
    private int settleBonusIfDue(IslandQuestOccurrence occurrence, IslandQuestJudge.Judgement judgement,
                                 Instant now) {
        if (occurrence.isBonusSettled() || !judgement.allAchieved()) {
            return 0;
        }
        if (occurrence.getRewardBonusPerMember() <= 0) {
            // 0마리 성공으로 미설정을 숨기지 않는다(QQ05) — 배포 구성 오류다.
            throw new IllegalStateException("퀘스트 보상 설정이 0 입니다.");
        }
        int bonus = judgement.bonusReward();
        credit(occurrence, IslandQuestClaim.KIND_ALL_ACHIEVED_BONUS, bonus, null,
                "quest-bonus:" + occurrence.getId());
        occurrence.settleBonus(now);
        return bonus;
    }

    /** 정산 한 건 — claim 행(도메인 유일)과 섬 통장 적립(원장 멱등키)을 같은 키로 묶는다. */
    private UUID credit(IslandQuestOccurrence occurrence, String kind, int amount, UUID claimedBy,
                        String walletKey) {
        IslandQuestClaim claim = claims.saveAndFlush(IslandQuestClaim.builder()
                .islandId(occurrence.getIslandId()).occurrenceId(occurrence.getId())
                .kind(kind).amount(amount).claimedBy(claimedBy)
                .walletIdempotencyKey(walletKey).build());
        wallet.creditQuestSettlement(occurrence.getIslandId(), amount, walletKey);
        return claim.getId();
    }

    /** 이 회차에서 개인 몫을 이미 받은 주민들 — 섬 id 를 함께 넘겨 유일 인덱스 선두 컬럼을 채운다. */
    private List<UUID> claimers(IslandQuestOccurrence occurrence) {
        return claims.findClaimerIds(occurrence.getIslandId(), occurrence.getId(),
                IslandQuestClaim.KIND_ACHIEVER);
    }

    // ---------------------------------------------------------------- 계정 탈퇴

    /**
     * 계정 탈퇴 파기 (GROMO-1950·1952, 계정 LLD §4) — 탈퇴자의 cohort 행은 지우고, 정산 행과 퀘스트 정의는
     * 남긴 채 수령자·작성자 연결만 끊는다. 호출측(AccountWithdrawalService)이 users 와 가입 섬 행을 이미 잠근
     * 한 트랜잭션이다.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void eraseWithdrawnUser(UUID userId) {
        occurrences.deleteCohortOfUser(userId);
        claims.detachClaimer(userId);
        quests.detachCreator(userId);
    }

    // ---------------------------------------------------------------- 회차 개설

    /**
     * 오늘(UTC) 회차가 없으면 연다 — 스케줄러가 퀘스트마다 자기 트랜잭션으로 부른다. 섬 행을 잠근 뒤 다시
     * 확인하므로 여러 인스턴스·생성 명령과 겹쳐도 한 번만 열린다. 종료·삭제된 섬은 건너뛴다.
     *
     * @return 새로 열었으면 true
     */
    @Transactional
    public boolean openTodayIfMissing(UUID questId) {
        IslandQuest quest = quests.findById(questId).orElse(null);
        if (quest == null) {
            return false;
        }
        LocalDate today = LocalDate.ofInstant(clock.instant(), ZoneOffset.UTC);
        membershipLocks.lockGroup(quest.getIslandId());
        Group island = groups.getGroup(quest.getIslandId());
        if (!isAlive(island) || occurrences.existsByQuestIdAndOccurrenceDate(questId, today)) {
            return false;
        }
        open(quest, today, Objects.requireNonNullElse(quest.getCreatedBy(), SYSTEM_ACTOR));
        return true;
    }

    /** 회차 하나를 연다 — 호출측이 섬 행을 잠근 상태여야 cohort 가 가입·탈퇴와 어긋나지 않는다. */
    private EventEnvelope open(IslandQuest quest, LocalDate date, UUID actorId) {
        IslandQuestOccurrence occurrence = occurrences.saveAndFlush(IslandQuestOccurrence.builder()
                .questId(quest.getId()).islandId(quest.getIslandId()).occurrenceDate(date)
                .definitionRevision(quest.getRevision()).type(quest.getType()).title(quest.getTitle())
                .targetMinutes(quest.getTargetMinutes())
                .windowStart(quest.getWindowStart()).windowEnd(quest.getWindowEnd())
                .rewardPerAchiever(rewardPerAchiever).rewardBonusPerMember(rewardBonusPerMember)
                .version(0).build());
        occurrences.snapshotCohort(occurrence.getId(), quest.getIslandId());
        EventEnvelope opened = questEvents.progressUpdated(occurrence, actorId);
        occurrence.progressed(opened.version());
        return opened;
    }

    // ---------------------------------------------------------------- 표현

    /**
     * 회차 헤더 — 수령 축은 요청한 주민 기준이다(GROMO-1991). cohort 밖(방문자·뒤늦은 가입자)이면
     * {@code myRate} 가 null 이고 수령도 못 한다.
     */
    private QuestViews.Item header(IslandQuestOccurrence occurrence, IslandQuestJudge.Judgement judgement,
                                   UUID viewerId, List<UUID> claimers) {
        Optional<IslandQuestJudge.Row> mine = judgement.rowOf(viewerId);
        boolean claimed = claimers.contains(viewerId);
        boolean claimable = !claimed && mine.filter(r -> r.counted() && r.achieved()).isPresent();
        String blocked = claimed || claimable ? null
                : mine.filter(IslandQuestJudge.Row::pending).isPresent()
                        ? QuestViews.BLOCKED_MEASUREMENT_PENDING
                        : QuestViews.BLOCKED_NOT_ACHIEVED;
        int bonus = occurrence.isBonusSettled()
                ? claims.findByIslandIdAndOccurrenceIdAndKind(occurrence.getIslandId(), occurrence.getId(),
                        IslandQuestClaim.KIND_ALL_ACHIEVED_BONUS).map(IslandQuestClaim::getAmount).orElse(0)
                : judgement.bonusReward();
        return new QuestViews.Item(occurrence.getQuestId(), occurrence.getId(), occurrence.getTitle(),
                occurrence.getType().wire(), hhmm(occurrence.getWindowStart()), hhmm(occurrence.getWindowEnd()),
                QuestViews.TIMEZONE, occurrence.getOccurrenceDate().toString(), occurrence.getTargetMinutes(),
                mine.map(IslandQuestJudge.Row::rate).orElse(null),
                new QuestViews.Reward(QuestViews.CURRENCY, occurrence.getRewardPerAchiever()),
                claimed ? QuestViews.STATUS_CLAIMED : QuestViews.STATUS_IN_PROGRESS,
                claimable, blocked, claimed, bonus, occurrence.isBonusSettled(), occurrence.getVersion());
    }

    private static String hhmm(LocalTime time) {
        return time == null ? null : time.format(WINDOW_FORMAT);
    }

    // ---------------------------------------------------------------- 가드

    /**
     * 조회 — 활성 계정 · 살아 있는 섬(404) · 게시판 완공(403). 잠금 없음. 주민 여부는 보지 않는다 — 방문자(가입
     * 대기자 포함)도 퀘스트와 주민별 달성률을 읽는다(2026-09-19 결정 V-읽기, GROMO-1904). 방문자의 {@code myRate}
     * 는 cohort 에 없으므로 null 이다.
     */
    private void requireReader(UUID islandId, UUID userId) {
        users.getCaller(userId);
        groups.findGroup(islandId)
                .filter(IslandQuestService::isAlive)
                .orElseThrow(() -> new GroupException(GroupErrorCode.GROUP_NOT_FOUND));
        requireBoard(islandId);
    }

    /** 쓰기(정산·재생) — 섬 행 배타 잠금 뒤 활성 주민·게시판. */
    private GroupMember requireResidentWriter(UUID islandId, UUID userId) {
        membershipLocks.lockGroup(islandId);
        if (!isAlive(groups.getGroup(islandId))) {
            throw new GroupException(GroupErrorCode.GROUP_NOT_FOUND);
        }
        GroupMember member = members.findActiveByUserIdAndGroupIdForShare(userId, islandId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));
        requireBoard(islandId);
        return member;
    }

    /** 생성·수정(재생 포함) — 주민 가드에 방장(D3)을 더한다. 재생도 «지금» 방장이어야 한다. */
    private void requireOwnerWriter(UUID islandId, UUID userId) {
        if (requireResidentWriter(islandId, userId).getRole() != GroupMemberRole.OWNER) {
            throw new QuestException(QuestErrorCode.QUEST_FORBIDDEN);
        }
    }

    private void requireBoard(UUID islandId) {
        if (!facilities.existsCompleted(islandId, ConstructionBuilding.BOARD.id())) {
            throw new QuestException(QuestErrorCode.QUEST_BOARD_LOCKED);
        }
    }

    private IslandQuest requireQuest(UUID islandId, UUID questId) {
        return quests.findById(questId)
                .filter(q -> q.getIslandId().equals(islandId))
                .orElseThrow(() -> new QuestException(QuestErrorCode.QUEST_NOT_FOUND));
    }

    private static boolean isAlive(Group island) {
        return island.getDeletedAt() == null && island.getStatus() != GroupStatus.ENDED;
    }

    // ---------------------------------------------------------------- 입력 검증

    /** 생략 또는 UTC 만 — 다른 값(Asia/Seoul 포함)은 창 시각을 다른 축으로 읽게 만들어 거절한다(결정 Q-6). */
    private static void requireTimezone(String timezone) {
        if (timezone != null && !QuestViews.TIMEZONE.equals(timezone)) {
            throw new QuestException(QuestErrorCode.QUEST_INVALID_TIMEZONE);
        }
    }

    /**
     * screen 퀘스트는 받지 않는다 — 스크린타임 하루 값의 날짜가 KST 라벨({@code ScreenTimeService} 의 보고 시각 KST
     * 환산)이라 UTC 회차로 읽으면 측정 창이 9시간 밀린다. 저장 축이 UTC 로 바뀌는 1930 전까지 422(결정 Q-6 보완).
     */
    private static void requireSupported(QuestType type) {
        if (type == QuestType.SCREEN) {
            throw new QuestException(QuestErrorCode.QUEST_TYPE_OUT_OF_RANGE);
        }
    }

    private static String title(String raw) {
        if (raw == null) {
            throw new QuestException(QuestErrorCode.QUEST_INVALID_REQUEST);
        }
        String title = raw.strip();
        int length = title.codePointCount(0, title.length());
        if (length == 0 || length > TITLE_MAX) {
            throw new QuestException(QuestErrorCode.QUEST_TITLE_OUT_OF_RANGE);
        }
        return title;
    }

    private static int target(Integer minutes) {
        if (minutes == null) {
            throw new QuestException(QuestErrorCode.QUEST_INVALID_REQUEST);
        }
        if (minutes < 1 || minutes > TARGET_MAX_MINUTES) {
            throw new QuestException(QuestErrorCode.QUEST_TARGET_OUT_OF_RANGE);
        }
        return minutes;
    }

    private static LocalTime windowTime(String raw) {
        if (raw == null || !HH_MM.matcher(raw).matches()) {
            throw new QuestException(QuestErrorCode.QUEST_INVALID_REQUEST);
        }
        try {
            return LocalTime.parse(raw, WINDOW_FORMAT);
        } catch (DateTimeParseException e) {
            throw new QuestException(QuestErrorCode.QUEST_INVALID_REQUEST);
        }
    }

    /** 창보다 긴 목표는 달성할 수 없다 — 0초짜리 성공 가능성조차 없는 정의를 만들지 않는다. */
    private static void requireTargetFits(int target, LocalTime start, LocalTime end) {
        if (target * 60L > end.toSecondOfDay() - start.toSecondOfDay()) {
            throw new QuestException(QuestErrorCode.QUEST_TARGET_OUT_OF_RANGE);
        }
    }

    // ---------------------------------------------------------------- 멱등 코덱

    private static JsonNode tree(Object value) {
        try {
            return OutboxEnvelopeCodec.fromJson(OutboxEnvelopeCodec.toJson(value), JsonNode.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("퀘스트 명령 직렬화 실패", e);
        }
    }

    private static <T> T decode(JsonNode data, Class<T> type) {
        try {
            return OutboxEnvelopeCodec.fromJson(data.toString(), type);
        } catch (JsonProcessingException e) {
            throw new OutboxException(OutboxErrorCode.IDEMPOTENT_REPLAY_FAILED);
        }
    }
}
