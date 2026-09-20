package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.construction.exception.ConstructionErrorCode;
import com.oneorthree.phone.construction.exception.ConstructionException;
import com.oneorthree.phone.construction.repository.IslandWalletTransactionRepository;
import com.oneorthree.phone.construction.repository.domain.IslandWalletTransaction;
import com.oneorthree.phone.construction.repository.domain.IslandWalletTransactionType;
import com.oneorthree.phone.construction.service.IslandFacilityQueryService;
import com.oneorthree.phone.focus.repository.FocusFishEarningsRepository;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.internal.dto.IslandFishEarningsView;
import com.oneorthree.phone.internal.dto.IslandLedgerPageView;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 섬 공동 경제의 읽기 두 종 (GROMO-1895) — 공동 가계부({@code GET /islands/{islandId}/resources/ledger})와
 * 주민별 누적 획득({@code GET /islands/{islandId}/statistics/fish-earnings}).
 *
 * <p>둘 다 활성 주민 전용이다 — 방장이든 일반 주민이든 같고, 구경꾼(비주민)은 {@code MEMBER_ONLY} 403 이다.
 * 섬 지갑은 모두의 것이라 역할로 가르지 않는다. 원장(construction)·정산(focus)·소속(group)을 함께 읽는
 * 조합이라 L10 internal 에 둔다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class IslandEconomyReadService {

    /** 가계부 limit 상한 — 다른 내부 목록과 같다. 기본값은 Business 몫이다. */
    private static final int MAX_LIMIT = 100;
    /** 최신순 첫 페이지 경계 — 어떤 실제 UUID 보다 크거나 같다(PostgreSQL uuid 는 부호 없는 바이트 비교). */
    private static final UUID LAST_ID = new UUID(-1L, -1L);

    /**
     * 최신순 keyset 축 — {@code (createdAt, id)} 내림차순. id 는 <b>부호 없이</b> 비교한다:
     * PostgreSQL 은 uuid 를 바이트 무부호로 정렬하는데 {@link UUID#compareTo} 는 부호 있는 long 두 개로
     * 비교해서, 커서 경계 행에서 두 순서가 갈리면 페이지가 빠지거나 겹친다(경계값 {@link #LAST_ID} 가 바로
     * 그런 값이다 — 무부호로는 최대, 부호로는 −1).
     */
    private static final Comparator<IslandLedgerPageView.Entry> LEDGER_ORDER =
            Comparator.comparing(IslandLedgerPageView.Entry::createdAt)
                    .thenComparing(IslandLedgerPageView.Entry::id, IslandEconomyReadService::compareUnsigned)
                    .reversed();

    private final UserQueryService userQueryService;
    private final GroupQueryService groupQueryService;
    private final GroupMemberRepository groupMemberRepository;
    private final IslandWalletTransactionRepository ledger;
    private final IslandFacilityQueryService facilities;
    private final FocusFishEarningsRepository fishEarnings;

    /**
     * 공동 가계부 — 한 달(KST 달력 월)의 원장 행을 최신순으로 자르고 그 달 전체의 적립·지출 합을 함께 준다.
     *
     * <p>합계와 페이지를 한 스냅샷에서 읽도록 REPEATABLE READ 다 — 두 SELECT 사이에 적립이 커밋돼도
     * 합계와 목록이 서로 다른 순간을 말하지 않는다.
     *
     * @param direction {@code earn|spend}, {@code null} 이면 둘 다
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public IslandLedgerPageView ledger(UUID userId, UUID islandId, YearMonth month, String direction,
                                       Instant afterCreatedAt, UUID afterEntryId, int limit) {
        if ((afterCreatedAt == null) != (afterEntryId == null) || limit < 1 || limit > MAX_LIMIT) {
            throw new GroupException(GroupErrorCode.INVALID_PAGE_REQUEST);
        }
        List<IslandWalletTransactionType> types = typesOf(direction);
        requireResident(userId, islandId);

        Instant from = month.atDay(1).atStartOfDay(ZonePolicy.KST).toInstant();
        Instant to = month.plusMonths(1).atDay(1).atStartOfDay(ZonePolicy.KST).toInstant();
        long earned = 0;
        long spent = 0;
        for (IslandWalletTransactionRepository.TypeTotal total : ledger.sumByTypeBetween(islandId, from, to)) {
            if (total.getType().isEarning()) {
                earned += total.getTotal();
            } else {
                spent += total.getTotal();
            }
        }
        Instant cursorAt = afterCreatedAt == null ? to : afterCreatedAt;
        UUID cursorId = afterEntryId == null ? LAST_ID : afterEntryId;

        // 집중 적립만 하루로 접는다(GROMO-1990) — 그 사유만 분당 1행이라 건별로 내보내면 한 달이 수천 줄이다.
        List<IslandWalletTransactionType> perRowTypes = types.stream()
                .filter(type -> type != IslandWalletTransactionType.CONTRIBUTION)
                .toList();
        List<IslandLedgerPageView.Entry> merged = new ArrayList<>();
        if (!perRowTypes.isEmpty()) {
            for (IslandWalletTransaction row : ledger.findLedgerPage(islandId, perRowTypes, from, to,
                    cursorAt, cursorId, PageRequest.of(0, limit + 1))) {
                merged.add(new IslandLedgerPageView.Entry(row.getId(),
                        row.getType().isEarning() ? "earn" : "spend",
                        row.getType().name().toLowerCase(Locale.ROOT), row.getAmount(), row.getCreatedAt(),
                        row.getCreatedAt(), 1));
            }
        }
        if (types.contains(IslandWalletTransactionType.CONTRIBUTION)) {
            // 묶음은 한 달에 최대 31행이라 커서와 무관하게 전부 읽고 메모리에서 자른다.
            for (IslandWalletTransactionRepository.DailyContribution day
                    : ledger.sumContributionsByDay(islandId, from, to, ZonePolicy.KST.getId())) {
                if (isOlderThanCursor(day.getStartedAt(), day.getId(), cursorAt, cursorId)) {
                    merged.add(new IslandLedgerPageView.Entry(day.getId(), "earn",
                            IslandWalletTransactionType.CONTRIBUTION.name().toLowerCase(Locale.ROOT),
                            Math.toIntExact(day.getAmount()), day.getStartedAt(), day.getEndedAt(),
                            Math.toIntExact(day.getEntryCount())));
                }
            }
        }
        // 두 갈래를 SQL 과 «같은» 최신순 keyset 축으로 다시 세운다.
        merged.sort(LEDGER_ORDER);
        boolean more = merged.size() > limit;
        List<IslandLedgerPageView.Entry> page = more ? merged.subList(0, limit) : merged;
        IslandLedgerPageView.Entry last = more ? page.get(page.size() - 1) : null;
        return new IslandLedgerPageView(month.toString(), earned, spent, page,
                last == null ? null : last.createdAt(), last == null ? null : last.id());
    }

    /** SQL 의 {@code (createdAt, id) < (커서)} 와 같은 판정 — 묶음 행을 메모리에서 거를 때 쓴다. */
    private static boolean isOlderThanCursor(Instant createdAt, UUID id, Instant cursorAt, UUID cursorId) {
        int byTime = createdAt.compareTo(cursorAt);
        return byTime < 0 || (byTime == 0 && compareUnsigned(id, cursorId) < 0);
    }

    /** PostgreSQL 의 uuid 정렬(바이트 무부호)과 같은 비교. */
    private static int compareUnsigned(UUID left, UUID right) {
        int high = Long.compareUnsigned(left.getMostSignificantBits(), right.getMostSignificantBits());
        return high != 0 ? high
                : Long.compareUnsigned(left.getLeastSignificantBits(), right.getLeastSignificantBits());
    }

    /**
     * 주민별 누적 획득 — 도서관이 완공된 섬에서만 연다({@code LIBRARY_LOCKED}). 완공 게이트는 다른 시설과 같은
     * {@code construction.facility-gates.enforce} 스위치를 따른다(기본 OFF 면 통과).
     */
    public IslandFishEarningsView fishEarnings(UUID userId, UUID islandId) {
        Group island = requireResident(userId, islandId);
        if (!facilities.hasLibrary(islandId)) {
            throw new GroupException(GroupErrorCode.LIBRARY_LOCKED);
        }
        // 탈퇴 계정은 is_left=false 로 남아도 주민으로 세지 않는다 — 주민 목록(섬 관리 LLD §3.2)과 같은 모수다.
        List<GroupMember> members = groupMemberRepository.findByGroup(island).stream()
                .filter(member -> !member.getUser().isDeleted())
                .toList();
        Map<UUID, Long> earned = fishEarnings.sumEarnedFishByUser(islandId,
                        members.stream().map(member -> member.getUser().getId()).toList())
                .stream()
                .collect(Collectors.toMap(FocusFishEarningsRepository.UserEarnings::getUserId,
                        FocusFishEarningsRepository.UserEarnings::getEarnedFish));
        return new IslandFishEarningsView(members.stream()
                .map(member -> new IslandFishEarningsView.Member(member.getUser().getId(),
                        member.getUser().getNickname(), earned.getOrDefault(member.getUser().getId(), 0L)))
                .sorted(Comparator.comparingLong(IslandFishEarningsView.Member::earnedFish).reversed()
                        .thenComparing(IslandFishEarningsView.Member::userId))
                .toList());
    }

    /** 살아 있는 섬의 활성 주민이어야 한다 — 비주민·떠난 주민은 {@code MEMBER_ONLY}, 죽은 섬은 {@code GROUP_NOT_FOUND}. */
    private Group requireResident(UUID userId, UUID islandId) {
        User caller = userQueryService.getCaller(userId);
        Group island = groupQueryService.getGroup(islandId);
        IslandMovementGuards.requireAlive(island);
        groupQueryService.getMembership(caller, island);
        return island;
    }

    /** 방향 필터 → 원장 사유 집합. 모르는 값은 422 {@code OUT_OF_RANGE} 다(형식이 아니라 값 범위 위반). */
    private static List<IslandWalletTransactionType> typesOf(String direction) {
        if (direction == null) {
            return List.of(IslandWalletTransactionType.values());
        }
        boolean earning = switch (direction) {
            case "earn" -> true;
            case "spend" -> false;
            default -> throw new ConstructionException(ConstructionErrorCode.OUT_OF_RANGE);
        };
        return Arrays.stream(IslandWalletTransactionType.values())
                .filter(type -> type.isEarning() == earning)
                .toList();
    }
}
