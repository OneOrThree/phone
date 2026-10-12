package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.TelescopePinRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.internal.dto.IslandNoticeViews;
import com.oneorthree.phone.internal.dto.TelescopeItemView;
import com.oneorthree.phone.internal.dto.TelescopePinView;
import com.oneorthree.phone.internal.service.TelescopeService.VisiblePin;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 망원경 핀 넣기·빼기 (GROMO-2268, 섬 외부 계약 §6) — 잡지·전망대로 «직접 넣은 섬». 목록에 끼우는 쪽은
 * {@link TelescopeService} 다.
 *
 * <p>한 사람의 만료 안 된 핀은 보이는 것 기준으로 최대 {@value TelescopeService#MAX_PINS}개다. 그보다 많아지면 {@code pinned_at}
 * 이 가장 오래된 핀을 같은 트랜잭션에서 지우고 응답의 {@code evicted} 로 알린다. 핀은 <b>다음 07:00 KST</b> 에 만료되고
 * 만료는 읽을 때 거른다 — 정리 잡은 없다. 같은 사람이 핀을 넣을 때 그 사람의 만료 행만 함께 지운다.
 *
 * <p>게스트도 쓴다: 쓰기이긴 해도 남에게 보이지 않는 개인 목록이라 소셜 로그인을 요구하지 않는다(정본 SAFE-01 「망원경」).
 * 항해 중인 섬을 빼는 것을 막는 검사는 없다 — 서버에 항해 상태가 없다(앱이 확인창으로 처리한다).
 *
 * <h2>잠금 — users 배타</h2>
 * 넣기는 먼저 사용자 행을 배타로 잡는다. 개수 판정(«5번째면 밀어낸다»)이 같은 사람의 동시 요청에 뚫리지 않게 하고,
 * 가입({@code IslandJoinService.join})·계정 탈퇴가 같은 행을 먼저 잡으므로 «내 소속이면 409» 가 낡은 값으로 통과하지
 * 않고 탈퇴 뒤에 핀이 새로 남지 않는다. 섬 행은 잠그지 않는다 — 비공개·종료·강퇴는 읽을 때 목록에서 빠지므로 그 사이에
 * 낀 변경은 «보이지 않는 핀» 하나로 끝난다.
 */
@Service
@RequiredArgsConstructor
public class TelescopePinService {

    private static final LocalTime RESET_TIME = LocalTime.of(7, 0);

    private final UserQueryService userQueryService;
    private final GroupQueryService groupQueryService;
    private final GroupMemberRepository groupMemberRepository;
    private final TelescopePinRepository pins;
    private final TelescopeService telescope;
    private final Clock clock;

    /**
     * 섬을 망원경에 넣는다.
     *
     * <p>판정 순서는 섬 생존 → 내 소속(409) → 강퇴 이력(403) → 비공개(404) 다. 내 소속·강퇴 이력은 본인이 아는 사실이라
     * 비공개 섬에서도 숨기지 않고(가입 경로와 같은 순서), 그 밖의 비공개·종료·삭제·없는 섬은 존재를 숨겨 같은 404 다.
     * 이미 만료 안 된 핀이 있으면 아무것도 바꾸지 않고 그 항목을 그대로 돌려준다(멱등, {@code created=false}).
     * 만료된 핀이 있으면 지우고 새로 넣는다.
     *
     * @param userId   핀의 주인 — 게스트도 된다
     * @param islandId 넣을 섬
     * @param source   {@code magazine|observatory}
     * @return 목록에서 보이는 그대로의 항목과 밀려난 핀(없으면 null)
     * @throws GroupException 없는·종료·비공개 섬 {@code GROUP_NOT_FOUND}(404) · 강퇴된 섬 {@code KICKED_CANNOT_REJOIN}(403) ·
     *                        이미 내 소속인 섬 {@code ALREADY_MEMBER}(409)
     */
    @Transactional
    public TelescopePinView pin(UUID userId, UUID islandId, String source) {
        User caller = userQueryService.getCallerForUpdate(userId);
        Instant now = clock.instant();
        Group island = groupQueryService.findGroup(islandId).filter(IslandMovementGuards::isAlive)
                .orElseThrow(() -> new GroupException(GroupErrorCode.GROUP_NOT_FOUND));
        Optional<GroupMember> prior = groupMemberRepository.findAnyByUserAndGroup(caller, island);
        if (prior.isPresent() && !prior.get().isLeft()) {
            throw new GroupException(GroupErrorCode.ALREADY_MEMBER);
        }
        if (prior.isPresent() && prior.get().isKicked()) {
            throw new GroupException(GroupErrorCode.KICKED_CANNOT_REJOIN);
        }
        if (island.isPrivate()) {
            throw new GroupException(GroupErrorCode.GROUP_NOT_FOUND);
        }

        pins.deleteExpiredOf(userId, now);
        boolean created = pins.insertIfAbsent(userId, islandId, source, now, nextReset(now)) == 1;
        TelescopePinView.Evicted evicted = created ? evictOverflow(userId, now) : null;
        // 응답의 항목은 목록이 이 핀을 내는 바로 그 항목이다 — 같은 시각으로 조립해 GET 과 어긋나지 않는다.
        TelescopeItemView item = telescope.list(userId, now).items().stream()
                .filter(view -> islandId.equals(view.islandId()) && TelescopeService.SLOT_PINNED.equals(view.slot()))
                .findFirst()
                // 방금 보여 줄 수 있다고 확인한 섬이 목록에 없다 — 그 사이 비공개·종료·강퇴가 끼어들었거나, 보이는 핀이
                // 4개를 넘은 채 가장 오래된 핀을 다시 넣은 드문 경우뿐이다. 둘 다 롤백하고 404 로 끝낸다.
                .orElseThrow(() -> new GroupException(GroupErrorCode.GROUP_NOT_FOUND));
        return new TelescopePinView(item, evicted, created);
    }

    /**
     * 섬을 망원경에서 뺀다 — 핀이 없어도(만료되어 이미 사라졌어도) 성공이다. 빈 자리는 목록 조립이 같은 버킷의 다음
     * 무작위 섬으로 채운다.
     *
     * @param userId   핀의 주인
     * @param islandId 뺄 섬
     * @return {@code {deleted:true}}
     */
    @Transactional
    public IslandNoticeViews.Deleted unpin(UUID userId, UUID islandId) {
        userQueryService.getCaller(userId);
        pins.deletePin(userId, islandId);
        return new IslandNoticeViews.Deleted(true);
    }

    /**
     * 보이는 핀이 {@value TelescopeService#MAX_PINS}개를 넘으면 가장 오래된 것부터 지운다. 정상 경로에서는 방금 넣은 핀 때문에
     * 정확히 하나가 넘는다. 알림은 «방금까지 보이던 마지막 핀» 하나다 — 숨어 있던 핀이 되살아나 둘 이상 넘친 드문 경우에도
     * 사용자가 목록에서 보던 것은 그 하나뿐이다.
     */
    private TelescopePinView.Evicted evictOverflow(UUID userId, Instant now) {
        List<VisiblePin> visible = telescope.visiblePins(userId, now);
        int overflow = visible.size() - TelescopeService.MAX_PINS;
        if (overflow <= 0) {
            return null;
        }
        List<VisiblePin> dropped = visible.subList(0, overflow);
        dropped.forEach(pin -> pins.deletePin(userId, pin.row().getId()));
        UUID last = dropped.get(overflow - 1).row().getId();
        return new TelescopePinView.Evicted(last, groupQueryService.getGroup(last).getName());
    }

    /** 다음 07:00 KST — 지금이 07:00 전이면 오늘, 아니면(정각 포함) 내일. KST 는 서머타임이 없다. */
    static Instant nextReset(Instant now) {
        ZonedDateTime kst = now.atZone(ZonePolicy.KST);
        ZonedDateTime today = kst.toLocalDate().atTime(RESET_TIME).atZone(ZonePolicy.KST);
        return (kst.isBefore(today) ? today : today.plusDays(1)).toInstant();
    }
}
