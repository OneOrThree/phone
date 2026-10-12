package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.construction.service.IslandFacilityQueryService;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.IslandGuestbookEntryRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.group.repository.domain.IslandGuestbookEntry;
import com.oneorthree.phone.internal.dto.IslandGuestbookViews;
import com.oneorthree.phone.internal.dto.IslandNoticeViews;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 섬 방명록 (GROMO-2262, 섬 외부 계약 §2) — 읽기는 방문자·주민 모두, 쓰기는 게시판이 지어진 섬에서만
 * (방문자·주민 모두), 삭제는 섬장만.
 *
 * <p>쓰기 판정 순서는 섬 생존 → 게시판 완공 → 오늘 이미 씀 이다. «하루» 는 KST 날짜다(결정 N6). 쓴 뒤 같은 TX 에서
 * 그 섬의 31번째 이후를 soft-delete 한다. 게스트 차단은 컨트롤러가 서비스 앞에서 한다({@link GuestAccountGuards}).
 * {@code IslandNoticeService} 와 같은 자리(엔티티·레포는 group, 조합 서비스는 internal)다.
 *
 * <p>ponytail: 같은 사람의 동시 두 쓰기는 «오늘 이미 씀» 선검사를 둘 다 통과해 유니크 제약이 막는다(500). 한 사람이
 * 한 섬에 같은 순간 두 번 보내는 일은 앱이 막으므로 잠금은 두지 않는다 — 몰리면 receipt 나 섬 행 잠금으로 직렬화한다.
 */
@Service
@RequiredArgsConstructor
public class IslandGuestbookService {

    private final UserQueryService users;
    private final GroupQueryService groups;
    private final IslandFacilityQueryService facilities;
    private final IslandGuestbookEntryRepository entries;
    private final Clock clock;

    /** 최근 30개. 게시판이 없으면 {@code boardBuilt=false} 와 빈 목록이다(글이 있어도 보이지 않는다). */
    @Transactional(readOnly = true)
    public IslandGuestbookViews.Page list(UUID islandId, UUID callerId) {
        users.getCaller(callerId);
        requireAliveIsland(islandId);
        if (!facilities.hasBoard(islandId)) {
            return new IslandGuestbookViews.Page(false, List.of());
        }
        List<IslandGuestbookEntry> rows =
                entries.findTop30ByIslandIdAndDeletedAtIsNullOrderByCreatedAtDescIdDesc(islandId);
        Map<UUID, String> names = new HashMap<>();
        for (User user : users.findAllActive(rows.stream().map(IslandGuestbookEntry::getAuthorId).distinct()
                .toList())) {
            names.put(user.getId(), user.getNickname());
        }
        return new IslandGuestbookViews.Page(true, rows.stream()
                .map(row -> toItem(row, names.get(row.getAuthorId()), callerId)).toList());
    }

    /** 쓰기 — {@code content} 는 이미 1~20 코드포인트로 걸러진 값이다({@code GuestbookWriteRequest}). */
    @Transactional
    public IslandGuestbookViews.Item write(UUID islandId, UUID callerId, String content) {
        User caller = users.getCaller(callerId);
        requireAliveIsland(islandId);
        if (!facilities.hasBoard(islandId)) {
            throw new GroupException(GroupErrorCode.BOARD_LOCKED);
        }
        LocalDate today = LocalDate.now(clock.withZone(ZonePolicy.KST));
        if (entries.existsByIslandIdAndAuthorIdAndWrittenOn(islandId, callerId, today)) {
            throw new GroupException(GroupErrorCode.GUESTBOOK_ALREADY_WRITTEN_TODAY);
        }
        IslandGuestbookEntry saved = entries.saveAndFlush(
                new IslandGuestbookEntry(islandId, callerId, content, today));
        entries.trimBeyondLatest30(islandId, Instant.now(clock));
        return toItem(saved, caller.getNickname(), callerId);
    }

    /** 삭제 — 섬장만(아니면 403 {@code NOT_OWNER}). 없는 글은 404 {@code NOT_FOUND}. */
    @Transactional
    public IslandNoticeViews.Deleted delete(UUID islandId, UUID callerId, UUID entryId) {
        User caller = users.getCaller(callerId);
        Group island = requireAliveIsland(islandId);
        groups.findMembership(caller, island).filter(member -> member.getRole() == GroupMemberRole.OWNER)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_OWNER));
        entries.findByIdAndIslandIdAndDeletedAtIsNull(entryId, islandId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND))
                .delete(Instant.now(clock));
        return new IslandNoticeViews.Deleted(true);
    }

    private Group requireAliveIsland(UUID islandId) {
        return groups.findGroup(islandId)
                .filter(group -> group.getDeletedAt() == null && group.getStatus() != GroupStatus.ENDED)
                .orElseThrow(() -> new GroupException(GroupErrorCode.GROUP_NOT_FOUND));
    }

    private static IslandGuestbookViews.Item toItem(IslandGuestbookEntry row, String authorName, UUID callerId) {
        return new IslandGuestbookViews.Item(row.getId(), row.getAuthorId(), authorName, row.getContent(),
                row.getCreatedAt(), callerId.equals(row.getAuthorId()));
    }
}
