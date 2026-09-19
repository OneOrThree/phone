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
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * 섬 퀘스트 5계약의 Data 측 구현 (GROMO-1773, island-quests LLD §1~§6).
 *
 * <p><b>잠금 순서</b>(LLD §5): 사용자(users 배타) → receipt 선점({@link PublicCommandService}) → 섬(groups
 * 배타) → 회차 → 섬 통장 → outbox version. 건설 명령(… 섬 → 건설 상태 → 지갑)과 집중 finish(… 섬 → 상세 →
 * 건설 상태 → 지갑)도 «섬 먼저, 지갑 마지막»이라 서로를 거꾸로 기다리지 않는다. 회차 행은 이 서비스만 잠근다.
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

    /** D5 개인 달성 +10 — 설정 값이다(QQ05 의 revision 등록 방식은 미결). */
    @Value("${island-quest.reward.per-achiever:10}")
    private int rewardPerAchiever;

    /** D5 전원 달성 보너스 1인당 5. */
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
                items.add(header(occurrence, judge.judge(occurrence, now), userId));
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
        List<QuestViews.Member> list = judgement.rows().stream()
                .map(r -> new QuestViews.Member(r.userId(), r.name(), r.rate(), r.measurementStatus()))
                .toList();
        return new QuestViews.Progress(header(occurrence, judgement, userId), list, null);
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
     * 회차 정산 — 주민 누구나 요청하고 서버가 판정한다(QQ04). 보상 전액이 섬 통장으로 간다(결정 Q-1).
     *
     * <p>순서(LLD §5): 같은 키 완료 receipt 는 멱등 계층이 먼저 원 결과를 재생한다 → 섬 잠금 → 회차 잠금 →
     * 이미 정산(다른 키)·수령 기한 지남이면 409 STATE_CONFLICT → expectedVersion 불일치 409 VERSION_CONFLICT →
     * 전체 cohort 판정, 미달성·측정 대기면 409 STATE_CONFLICT → claim 행(도메인 유일) → 섬 통장 적립 →
     * quest.progress.updated·wallet.updated. 어느 단계 실패도 전부 롤백한다.
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
                    if (occurrence.isClaimed() || !now.isBefore(occurrence.claimDeadline())) {
                        throw new QuestException(QuestErrorCode.QUEST_STATE_CONFLICT);
                    }
                    if (expectedVersion != occurrence.getVersion()) {
                        throw new QuestException(QuestErrorCode.QUEST_VERSION_CONFLICT);
                    }
                    IslandQuestJudge.Judgement judgement = judge.judge(occurrence, now);
                    if (!judgement.claimable()) {
                        throw new QuestException(QuestErrorCode.QUEST_STATE_CONFLICT);
                    }
                    int amount = judgement.potentialReward();
                    if (amount <= 0) {
                        // 0마리 성공으로 미설정을 숨기지 않는다(QQ05) — 배포 구성 오류다.
                        throw new IllegalStateException("퀘스트 보상 설정이 0 입니다.");
                    }
                    String walletKey = "quest:" + occurrence.getId();
                    IslandQuestClaim claim = claims.saveAndFlush(IslandQuestClaim.builder()
                            .islandId(islandId).occurrenceId(occurrence.getId())
                            .kind(IslandQuestClaim.KIND_SETTLEMENT).amount(amount).claimedBy(userId)
                            .walletIdempotencyKey(walletKey).build());
                    wallet.creditQuestSettlement(islandId, amount, walletKey);
                    EventEnvelope progress = questEvents.progressUpdated(occurrence, userId);
                    occurrence.markClaimed(now, progress.version());
                    EventEnvelope walletUpdated = walletEvents.changed(islandId, userId, "QUEST_SETTLEMENT");
                    return new PublicCommandResult(200,
                            tree(new QuestViews.Claimed(claim.getId(), occurrence.getId(), amount, true)),
                            tree(List.of(progress, walletUpdated)));
                }).value().data();
        return decode(data, QuestViews.Claimed.class);
    }

    // ---------------------------------------------------------------- 계정 탈퇴

    /**
     * 계정 탈퇴 파기 (GROMO-1950, 계정 LLD §4) — 탈퇴자의 cohort 행은 지우고, 정산 행은 남긴 채 수령자
     * 연결만 끊는다. 호출측(AccountWithdrawalService)이 users 와 가입 섬 행을 이미 잠근 한 트랜잭션이다.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void eraseWithdrawnUser(UUID userId) {
        occurrences.deleteCohortOfUser(userId);
        claims.detachClaimer(userId);
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
        open(quest, today, quest.getCreatedBy());
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
        occurrence.opened(opened.version());
        return opened;
    }

    // ---------------------------------------------------------------- 표현

    private QuestViews.Item header(IslandQuestOccurrence occurrence, IslandQuestJudge.Judgement judgement,
                                   UUID viewerId) {
        Integer myRate = judgement.rows().stream().filter(r -> r.userId().equals(viewerId))
                .map(IslandQuestJudge.Row::rate).findFirst().orElse(null);
        int amount = occurrence.isClaimed()
                ? claims.findByIslandIdAndOccurrenceIdAndKind(occurrence.getIslandId(), occurrence.getId(),
                        IslandQuestClaim.KIND_SETTLEMENT).map(IslandQuestClaim::getAmount).orElse(0)
                : judgement.potentialReward();
        return new QuestViews.Item(occurrence.getQuestId(), occurrence.getId(), occurrence.getTitle(),
                occurrence.getType().wire(), hhmm(occurrence.getWindowStart()), hhmm(occurrence.getWindowEnd()),
                QuestViews.TIMEZONE, occurrence.getOccurrenceDate().toString(), occurrence.getTargetMinutes(),
                myRate, new QuestViews.Reward(QuestViews.CURRENCY, amount),
                occurrence.isClaimed() ? QuestViews.STATUS_CLAIMED : QuestViews.STATUS_IN_PROGRESS,
                judgement.claimable(), judgement.blockedReason(), occurrence.isClaimed(), occurrence.getVersion());
    }

    private static String hhmm(LocalTime time) {
        return time == null ? null : time.format(WINDOW_FORMAT);
    }

    // ---------------------------------------------------------------- 가드

    /** 조회 — 활성 계정 · 살아 있는 섬(404) · 활성 주민(403) · 게시판 완공(403). 잠금 없음. */
    private void requireReader(UUID islandId, UUID userId) {
        users.getCaller(userId);
        Group island = groups.findGroup(islandId)
                .filter(IslandQuestService::isAlive)
                .orElseThrow(() -> new GroupException(GroupErrorCode.GROUP_NOT_FOUND));
        members.findActiveByUserIdAndGroupId(userId, island.getId())
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));
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
