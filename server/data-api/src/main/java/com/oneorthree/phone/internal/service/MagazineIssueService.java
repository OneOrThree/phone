package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.internal.dto.MagazineViews;
import com.oneorthree.phone.magazine.exception.MagazineErrorCode;
import com.oneorthree.phone.magazine.exception.MagazineException;
import com.oneorthree.phone.magazine.repository.IslandPromotionRepository;
import com.oneorthree.phone.magazine.repository.MagazineIssueRepository;
import com.oneorthree.phone.magazine.repository.MagazineReceiptRepository;
import com.oneorthree.phone.magazine.repository.domain.IslandPromotion;
import com.oneorthree.phone.magazine.repository.domain.MagazineIssue;
import com.oneorthree.phone.magazine.repository.domain.MagazineReceipt;
import com.oneorthree.phone.magazine.support.IslandCard;
import com.oneorthree.phone.magazine.support.MagazineCalendar;
import com.oneorthree.phone.magazine.support.MagazineEditorial;
import com.oneorthree.phone.user.repository.UserQueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 고양이 잡지 읽기와 받음 상태 (GROMO-2289, 잡지 구현 계획 §3-6~3-9) — 오늘 호, 최근 7호(잡지 꽂이), 호 한 페이지, 받음·
 * 나중에·읽음. 로그인한 누구나(게스트 포함) 읽는다. 서버는 독자가 바다에 있는지 섬에 있는지 모른다 — 「바다에서는 오늘
 * 호만」·「섬에서 펼치면 동그라미 없음」은 앱 규칙이다.
 *
 * <h2>읽는 순간 빼는 것</h2>
 * 07시에 고정한 숫자라도 지금 비공개이거나 닫힌 섬은 칸에서도 편집부 칸에서도 빠진다(SAFE-03), 신고로 숨겨졌거나 내려간
 * 칸도 빠진다 — 그래서 숨김이 «모든 독자에게서 즉시» 다. 섬과 나의 관계({@code relation})도 읽는 순간 계산한다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class MagazineIssueService {

    /** 호 한 페이지 상한 — 기본값(30)은 Business 의 몫이다. */
    private static final int MAX_PAGE = 100;
    /** 첫 페이지 경계 — 어떤 칸보다도 이르다. */
    private static final UUID FIRST_ID = new UUID(0L, 0L);

    private final UserQueryService users;
    private final MagazineIssueRepository issues;
    private final MagazineReceiptRepository receipts;
    private final IslandPromotionRepository promotions;
    private final GroupRepository islands;
    private final GroupMemberRepository members;
    private final Clock clock;

    /** 오늘 호(가장 최근에 나온 호)와 내 받음 상태. 07시 전이거나 발행이 늦어지면 어제 호가 오늘 호다. */
    public MagazineViews.Today today(UUID userId) {
        users.getCaller(userId);
        List<MagazineIssue> latest = issues.findTop7ByOrderByIssueNoDesc();
        if (latest.isEmpty()) {
            return new MagazineViews.Today(null, null);
        }
        MagazineIssue issue = latest.get(0);
        MagazineViews.Receipt receipt = receipts.findById(key(userId, issue.getId())).map(MagazineIssueService::view)
                .orElse(null);
        return new MagazineViews.Today(summary(issue, latest), receipt);
    }

    /** 잡지 꽂이 — 최근 7호, 최신 호가 먼저. */
    public MagazineViews.Shelf shelf(UUID userId) {
        users.getCaller(userId);
        List<MagazineIssue> latest = issues.findTop7ByOrderByIssueNoDesc();
        Set<UUID> opened = receipts.findByUserIdAndIssueIdIn(userId, latest.stream().map(MagazineIssue::getId)
                        .toList()).stream()
                .filter(receipt -> receipt.getOpenedAt() != null)
                .map(MagazineReceipt::getIssueId)
                .collect(Collectors.toSet());
        return new MagazineViews.Shelf(latest.stream()
                .map(issue -> new MagazineViews.ShelfItem(issue.getId(), issue.getIssueNo(), issue.getIssueDate(),
                        issue.getPublishedAt(), opened.contains(issue.getId())))
                .toList());
    }

    /**
     * 호 한 페이지 — 첫 페이지(경계 없음)에만 편집부 칸을 싣는다. 칸은 지면 순서({@code applied_at, id})다.
     *
     * @param afterAppliedAt 직전 페이지 마지막 칸의 신청 시각. 첫 페이지는 null
     * @param afterId        직전 페이지 마지막 칸의 id. {@code afterAppliedAt} 과 둘 다 있거나 둘 다 null
     */
    public MagazineViews.IssuePage issue(UUID userId, UUID issueId, Instant afterAppliedAt, UUID afterId, int limit) {
        if (limit < 1 || limit > MAX_PAGE || (afterAppliedAt == null) != (afterId == null)) {
            throw new GroupException(GroupErrorCode.INVALID_PAGE_REQUEST);
        }
        users.getCaller(userId);
        List<MagazineIssue> latest = issues.findTop7ByOrderByIssueNoDesc();
        MagazineIssue issue = recent(latest, issueId);
        boolean firstPage = afterAppliedAt == null;
        List<IslandPromotion> page = promotions.findVisiblePage(issue.getIssueDate(),
                firstPage ? Instant.EPOCH : afterAppliedAt, firstPage ? FIRST_ID : afterId,
                PageRequest.of(0, limit + 1));
        boolean more = page.size() > limit;
        List<IslandPromotion> cells = more ? page.subList(0, limit) : page;
        Relations relations = relations(userId);
        IslandPromotion last = more ? cells.get(cells.size() - 1) : null;
        return new MagazineViews.IssuePage(summary(issue, latest),
                firstPage ? editorial(issue.getEditorial(), relations) : null,
                cells.stream().map(promotion -> cell(promotion, relations)).toList(),
                last == null ? null : last.getAppliedAt(), last == null ? null : last.getId());
    }

    /**
     * 받음·나중에·읽음 — 행이 없으면 만들고(받은 곳·시각은 처음 값으로 고정), {@code deferred}·{@code opened} 가 처음 true 로
     * 올 때 그 시각을 적는다. false 로 되돌리지 않는다. 몇 번 보내도 결과가 같다 — 명령 키가 없다.
     */
    @Transactional
    public MagazineViews.Receipt receive(UUID userId, UUID issueId, MagazineViews.ReceiptRequest request) {
        // 사용자 행 공유 잠금 — 계정 탈퇴(배타 잠금 뒤 받음 상태 삭제)와 줄을 세운다. 탈퇴가 먼저면 여기서 기다렸다가
        // 404 USER_NOT_FOUND 로 끝나고, 이쪽이 먼저면 탈퇴가 이 커밋 뒤에 지운다 — 지워진 열람 기록이 되살아나지 않는다.
        users.getCallerForShare(userId);
        Instant now = clock.instant();
        // 「최근 7호인가」 와 삽입을 한 문장으로 묶는다 — 7호 밖이 된 호에는 행을 만들지 않는다.
        receipts.insertIfAbsent(userId, issueId, request.place().name(), now);
        MagazineReceipt receipt = receipts.findForUpdate(userId, issueId)
                .filter(row -> issues.findTop7ByOrderByIssueNoDesc().stream()
                        .anyMatch(issue -> issue.getId().equals(issueId)))
                .orElseThrow(() -> new MagazineException(MagazineErrorCode.MAGAZINE_ISSUE_NOT_FOUND));
        if (Boolean.TRUE.equals(request.deferred())) {
            receipt.markDeferred(now);
        }
        if (Boolean.TRUE.equals(request.opened())) {
            receipt.markOpened(now);
        }
        return view(receipt);
    }

    /** 최근 7호 안의 호 — 밖이면 404(지난 호는 7호까지만, MAG-07). */
    private static MagazineIssue recent(List<MagazineIssue> latest, UUID issueId) {
        return latest.stream().filter(issue -> issue.getId().equals(issueId)).findFirst()
                .orElseThrow(() -> new MagazineException(MagazineErrorCode.MAGAZINE_ISSUE_NOT_FOUND));
    }

    /** 현재 호 = 가장 최근 호이면서 다음 날 07:00 KST 전 — 망원경 동그라미·잡지 경유 집계의 기준이다. */
    private MagazineViews.IssueSummary summary(MagazineIssue issue, List<MagazineIssue> latest) {
        boolean current = latest.get(0).getId().equals(issue.getId())
                && clock.instant().isBefore(MagazineCalendar.currentUntil(issue.getIssueDate()));
        return new MagazineViews.IssueSummary(issue.getId(), issue.getIssueNo(), issue.getIssueDate(),
                issue.getPublishedAt(), current);
    }

    private MagazineViews.Editorial editorial(MagazineEditorial stored, Relations relations) {
        Set<UUID> visible = visible(stored);
        return new MagazineViews.Editorial(
                stored.ranking().stream().filter(row -> visible.contains(row.island().islandId()))
                        .map(row -> {
                            IslandCard card = row.island();
                            return new MagazineViews.RankedIsland(row.rank(), card.islandId(), card.name(),
                                    card.buildingCount(), card.memberCount(), card.maxMembers(),
                                    card.averageFocusMinutesPerDay(), relations.of(card.islandId()));
                        }).toList(),
                stored.newIslands().stream().filter(card -> visible.contains(card.islandId()))
                        .map(card -> new MagazineViews.Island(card.islandId(), card.name(), card.buildingCount(),
                                card.memberCount(), card.maxMembers(), card.averageFocusMinutesPerDay(),
                                relations.of(card.islandId())))
                        .toList(),
                stored.note());
    }

    /** 편집부 칸의 섬 중 지금도 공개·살아 있는 섬. */
    private Set<UUID> visible(MagazineEditorial stored) {
        Set<UUID> ids = new HashSet<>();
        stored.ranking().forEach(row -> ids.add(row.island().islandId()));
        stored.newIslands().forEach(card -> ids.add(card.islandId()));
        if (ids.isEmpty()) {
            return ids;
        }
        return islands.findAllById(ids).stream()
                .filter(island -> IslandMovementGuards.isAlive(island) && !island.isPrivate())
                .map(island -> island.getId())
                .collect(Collectors.toSet());
    }

    private static MagazineViews.Cell cell(IslandPromotion promotion, Relations relations) {
        IslandCard card = promotion.getSnapshot();
        return new MagazineViews.Cell(promotion.getId(), promotion.getIslandId(), card.name(), card.buildingCount(),
                card.memberCount(), card.maxMembers(), card.averageFocusMinutesPerDay(), promotion.getBody(),
                promotion.getLayout(), relations.of(promotion.getIslandId()));
    }

    /** 독자의 소속 섬·강퇴된 섬 — 칸마다 묻지 않고 한 번에 읽는다. */
    private Relations relations(UUID userId) {
        return new Relations(
                members.findActiveMembershipsByUserId(userId).stream()
                        .map(membership -> membership.getGroup().getId()).collect(Collectors.toSet()),
                new HashSet<>(members.findKickedGroupIdsByUserId(userId)));
    }

    private static MagazineReceipt.Key key(UUID userId, UUID issueId) {
        return new MagazineReceipt.Key(userId, issueId);
    }

    private static MagazineViews.Receipt view(MagazineReceipt receipt) {
        return new MagazineViews.Receipt(MagazineViews.Place.valueOf(receipt.getReceivedPlace()),
                receipt.getReceivedAt(), receipt.getDeferredAt(), receipt.getOpenedAt());
    }

    /** 읽는 순간의 관계 — 소속이 강퇴 이력보다 먼저다(강퇴 후 다시 들어온 섬은 소속이다). */
    private record Relations(Set<UUID> memberOf, Set<UUID> kickedFrom) {

        MagazineViews.Relation of(UUID islandId) {
            if (memberOf.contains(islandId)) {
                return MagazineViews.Relation.MEMBER;
            }
            return kickedFrom.contains(islandId) ? MagazineViews.Relation.KICKED : MagazineViews.Relation.NONE;
        }
    }
}
