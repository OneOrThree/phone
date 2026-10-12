package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.common.support.BannedWords;
import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.construction.repository.domain.ConstructionBuilding;
import com.oneorthree.phone.construction.service.IslandFacilityQueryService;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.IslandGuestbookEntryRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.group.repository.domain.IslandGuestbookEntry;
import com.oneorthree.phone.group.service.GroupMembershipMutationLocks;
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
 * <p>쓰기 판정 순서는 금칙어 → 섬 생존 → 게시판 완공 → 오늘 이미 씀 이다. «하루» 는 KST 날짜다(결정 N6). 쓴 뒤 같은
 * TX 에서 그 섬의 31번째 이후를 soft-delete 한다. 게스트 차단은 컨트롤러가 서비스 앞에서 한다
 * ({@link GuestAccountGuards}). {@code IslandNoticeService} 와 같은 자리(엔티티·레포는 group, 조합 서비스는
 * internal)다.
 *
 * <h2>잠금 — users 공유 → 섬(groups) 배타</h2>
 * {@code IslandNoticeService#run} 과 같은 순서다. 섬 행을 배타로 쥐어야 «삽입 → 31번째 이후 정리» 가 섬 단위로
 * 직렬화된다 — 안 쥐면 29개인 섬에 다른 두 작성자가 동시에 써도 둘 다 서로의 미커밋 행을 못 봐 31개가 남는다
 * (READ COMMITTED). 같은 사람의 동시 두 쓰기도 같은 잠금에 직렬화돼 둘째는 «오늘 이미 씀» 409 가 된다(유니크 제약
 * 위반 500 이 아니다). users 를 먼저 쥐는 이유는 계정 탈퇴(users 배타 → 섬 잠금)와 순서를 맞춰 교착을 피하는
 * 것이다. 읽기와 섬장 삭제는 잠그지 않는다 — 삭제는 한 행의 {@code deleted_at} 만 바꿔 상한 30 을 넘기지 않는다.
 */
@Service
@RequiredArgsConstructor
public class IslandGuestbookService {

    private final UserQueryService users;
    private final GroupQueryService groups;
    private final GroupMembershipMutationLocks membershipLocks;
    private final IslandFacilityQueryService facilities;
    private final IslandGuestbookEntryRepository entries;
    private final BannedWords bannedWords;
    private final Clock clock;

    /**
     * 최근 30개. {@code boardBuilt} 는 게시판이 <b>실제로 완공</b>됐는가다 — 섬 상세의 {@code buildings} 와 같은
     * 근거({@code completedBuildings})라 시설 게이트 플래그({@code construction.facility-gates.enforce})와
     * 무관하다. 목록 공개 여부는 쓰기와 같은 게이트({@code hasBoard}, 플래그 존중)다: 게이트가 켜진 환경에서
     * 게시판이 없으면 빈 목록이다.
     */
    @Transactional(readOnly = true)
    public IslandGuestbookViews.Page list(UUID islandId, UUID callerId) {
        users.getCaller(callerId);
        requireAliveIsland(islandId);
        boolean built = facilities.completedBuildings(islandId).contains(ConstructionBuilding.BOARD.id());
        if (!facilities.hasBoard(islandId)) {
            return new IslandGuestbookViews.Page(built, List.of());
        }
        List<IslandGuestbookEntry> rows =
                entries.findTop30ByIslandIdAndDeletedAtIsNullOrderByCreatedAtDescIdDesc(islandId);
        Map<UUID, String> names = new HashMap<>();
        for (User user : users.findAllActive(rows.stream().map(IslandGuestbookEntry::getAuthorId).distinct()
                .toList())) {
            names.put(user.getId(), user.getNickname());
        }
        return new IslandGuestbookViews.Page(built, rows.stream()
                .map(row -> toItem(row, names.get(row.getAuthorId()), callerId)).toList());
    }

    /**
     * 쓰기 — {@code content} 는 이미 1~20 코드포인트로 걸러진 값이다({@code GuestbookWriteRequest}). 금칙어는
     * 공지·댓글·섬 소개와 같은 목록·같은 코드({@code BANNED_WORD} 400)로 거절한다.
     */
    @Transactional
    public IslandGuestbookViews.Item write(UUID islandId, UUID callerId, String content) {
        bannedWords.requireClean(content);
        User caller = users.getCallerForShare(callerId);
        membershipLocks.lockGroup(islandId);
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
