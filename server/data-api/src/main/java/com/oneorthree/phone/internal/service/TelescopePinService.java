package com.oneorthree.phone.internal.service;

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
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 망원경 핀 넣기·빼기 (GROMO-2268, 섬 외부 계약 §6) — 잡지·전망대로 «직접 넣은 섬». 목록에 끼우는 쪽은
 * {@link TelescopeService} 다.
 *
 * <p>한 사람의 만료 안 된 핀은 보이는 것 기준으로 최대 {@value TelescopeService#MAX_PINS}개다. 넣기는 새 핀이든 이미 있던
 * 핀이든 보이는 핀이 그보다 많으면 넘친 만큼 {@code pinned_at} 이 가장 오래된 것부터 같은 트랜잭션에서 지우고 응답의
 * {@code evicted} 로 알린다 — 단 <b>지금 넣는 섬은 지우지 않는다</b>. 숨어 있던 핀이 되살아나(그 섬을 자진해서 떠나) 보이는
 * 핀이 이미 한도를 넘었다면 목록은 가장 최근 {@value TelescopeService#MAX_PINS}개만 보여 주고 가장 오래된 핀은 «잘리는데»,
 * 그 핀을 다시 넣으면 넣은 섬이 남고 다른 오래된 핀이 밀려난다. 핀은 <b>넣은 1시간 버킷의 끝</b>(다음 정시)에 무작위 섬과
 * 함께 만료되고(GROMO-2306, 정본 SCOPE-07) 만료는 읽을 때 거른다 — 정리 잡은 없다. 같은 사람이 핀을 넣을 때 그 사람의 만료 행만 함께 지운다.
 *
 * <p>게스트도 쓴다: 쓰기이긴 해도 남에게 보이지 않는 개인 목록이라 소셜 로그인을 요구하지 않는다(정본 SAFE-01 「망원경」).
 * 항해 중인 섬을 빼는 것을 막는 검사는 없다 — 서버에 항해 상태가 없다(앱이 확인창으로 처리한다).
 *
 * <h2>잠금 — users 배타</h2>
 * 넣기와 빼기는 둘 다 먼저 사용자 행을 배타로 잡는다. 개수 판정(«5번째면 밀어낸다»)이 같은 사람의 동시 요청에 뚫리지
 * 않게 하고, 가입({@code IslandJoinService.join})·계정 탈퇴가 같은 행을 먼저 잡으므로 «내 소속이면 409» 가 낡은 값으로
 * 통과하지 않고 탈퇴 뒤에 핀이 새로 남지 않는다. <b>빼기가 줄을 서야</b> 하는 이유는 «이미 있는 핀 다시 넣기» 다 — 그 넣기는
 * INSERT(0행)를 한 뒤 목록을 다시 읽어 항목을 만드는데, 그 사이에 빼기가 커밋되면 멀쩡한 공개 섬에 404 가 나간다. 같은
 * 잠금 뒤에 서면 넣기는 자기 핀을 보거나(빼기가 뒤), 빼기가 먼저였다면 핀을 다시 넣는다. 섬 행은 잠그지 않는다 —
 * 비공개·종료·내 소속은 읽을 때 목록에서 빠지므로 그 사이에 낀 변경은 «보이지 않는 핀» 하나로 끝난다.
 */
@Service
@RequiredArgsConstructor
public class TelescopePinService {

    /** 잡지 칸에서 넣은 핀의 출처. */
    private static final String SOURCE_MAGAZINE = "magazine";

    private final UserQueryService userQueryService;
    private final GroupQueryService groupQueryService;
    private final GroupMemberRepository groupMemberRepository;
    private final TelescopePinRepository pins;
    private final TelescopeService telescope;
    private final MagazinePinService magazinePins;
    private final Clock clock;

    /**
     * 섬을 망원경에 넣는다.
     *
     * <p>판정 순서는 섬 생존 → 내 소속(409) → 비공개(404) 다. 내 소속은 본인이 아는 사실이라 비공개 섬에서도 숨기지 않고
     * (가입 경로와 같은 순서), 그 밖의 비공개·종료·삭제·없는 섬은 존재를 숨겨 같은 404 다. 강퇴된 섬도 넣을 수 있다
     * (GROMO-2315, 10/20 결정 — 다시 가입 신청할 수 있는 섬이다).
     * 이미 만료 안 된 핀이 있으면 그 핀(출처·넣은 시각)은 바꾸지 않고 그 항목을 돌려준다(멱등, {@code created=false}).
     * 만료된 핀이 있으면 지우고 새로 넣는다. 넘친 핀 밀어내기는 새 핀이든 이미 있던 핀이든 돈다 — 지금 넣는 섬은 빼고라서,
     * 목록에서 «잘려» 있던 핀을 다시 넣어도 그 섬이 남아 목록에 나온다. 같은 다시 넣기를 두 번 보내면 첫 번째가 넘침을
     * 정리하고({@code evicted} 가 있을 수 있다) 두 번째는 {@code evicted=null} 이다 — 상태는 같은 곳으로 수렴한다.
     *
     * @param userId   핀의 주인 — 게스트도 된다
     * @param islandId 넣을 섬
     * @param source   {@code magazine|observatory}
     * @param promotionId 잡지 칸에서 넣었으면 그 홍보(없으면 null) — 핀의 말풍선 미리보기에만 쓰고,
     *                    핀을 넣을지 말지에는 영향이 없다
     * @return 목록에서 보이는 그대로의 항목과 밀려난 핀(없으면 null)
     * @throws GroupException 없는·종료·비공개 섬 {@code GROUP_NOT_FOUND}(404) · 이미 내 소속인 섬 {@code ALREADY_MEMBER}(409)
     */
    @Transactional
    public TelescopePinView pin(UUID userId, UUID islandId, String source, UUID promotionId) {
        User caller = userQueryService.getCallerForUpdate(userId);
        Instant now = clock.instant();
        Group island = groupQueryService.findGroup(islandId).filter(IslandMovementGuards::isAlive)
                .orElseThrow(() -> new GroupException(GroupErrorCode.GROUP_NOT_FOUND));
        Optional<GroupMember> prior = groupMemberRepository.findAnyByUserAndGroup(caller, island);
        if (prior.isPresent() && !prior.get().isLeft()) {
            throw new GroupException(GroupErrorCode.ALREADY_MEMBER);
        }
        if (island.isPrivate()) {
            throw new GroupException(GroupErrorCode.GROUP_NOT_FOUND);
        }

        pins.deleteExpiredOf(userId, now);
        // 홍보 칸은 이 섬의 현재 호에 보이는 칸만 핀 행에 남긴다 — 미리보기는 그 칸만 싣는다.
        UUID viaPromotion = promotionId != null && SOURCE_MAGAZINE.equals(source)
                && magazinePins.isVisiblePromotion(islandId, promotionId, now) ? promotionId : null;
        boolean created = pins.insertIfAbsent(userId, islandId, source, viaPromotion, now, nextReset(now)) == 1;
        // 새 핀이든 이미 있던 핀이든 민다 — 되살아난 핀 때문에 보이는 핀이 이미 한도를 넘어 있을 수 있다. 넣는 섬은 빼고 민다.
        TelescopePinView.Evicted evicted = evictOverflow(userId, now, islandId);
        // 응답의 항목은 목록이 이 핀을 내는 바로 그 항목이다 — 같은 시각으로 조립해 GET 과 어긋나지 않는다.
        TelescopeItemView item = telescope.list(userId, now).items().stream()
                .filter(view -> islandId.equals(view.islandId()) && TelescopeService.SLOT_PINNED.equals(view.slot()))
                .findFirst()
                // 방금 보여 줄 수 있다고 확인한 섬이 목록에 없다 — 그 사이 비공개·종료가 끼어든 경우뿐이다(넣는 섬은
                // 밀어내지 않아 보이는 핀이 넘쳐도 «잘려서» 빠지지 않는다). 롤백하고 404 로 끝낸다.
                .orElseThrow(() -> new GroupException(GroupErrorCode.GROUP_NOT_FOUND));
        return new TelescopePinView(item, evicted, created);
    }

    /**
     * 섬을 망원경에서 뺀다 — 핀이 없어도(만료되어 이미 사라졌어도) 성공이다. 빈 자리는 목록 조립이 이 버킷 스냅샷에서
     * 밀려났던 섬으로 채운다. 넣기와 같은 사용자 행 배타 잠금을 <b>가장 먼저</b> 잡는다 — 클래스 주석의 «잠금» 참조.
     *
     * @param userId   핀의 주인
     * @param islandId 뺄 섬
     * @return {@code {deleted:true}}
     */
    @Transactional
    public IslandNoticeViews.Deleted unpin(UUID userId, UUID islandId) {
        userQueryService.getCallerForUpdate(userId);
        pins.deletePin(userId, islandId);
        return new IslandNoticeViews.Deleted(true);
    }

    /**
     * 보이는 핀이 {@value TelescopeService#MAX_PINS}개를 넘으면 넘친 만큼 지운다 — <b>지금 넣는 섬은 빼고</b> 나머지 중 가장
     * 오래된 것부터. 그래서 넣은 섬은 늘 가장 최근 {@value TelescopeService#MAX_PINS}개 안에 남아 목록에 나온다. 정상
     * 경로(꽉 찬 목록에 하나를 더 넣음)에서는 방금 넣은 핀 때문에 정확히 하나가 넘친다. 숨어 있던 핀이 되살아나 보이는 핀이
     * 이미 한도를 넘어 있었다면(목록은 가장 오래된 핀을 «자른다») 둘 이상이 넘치고, 새 핀이 아닌 «잘린 핀 다시 넣기» 도 하나
     * 이상 밀어낸다. 알림은 «지운 것 중 가장 최근 것» 하나다 — 더 오래된 것은 이미 목록에서 잘려 있던 핀이다.
     *
     * @param protectedIslandId 지금 넣는 섬 — 밀어내지 않는다
     * @return 알릴 핀. 넘침이 없으면 null
     */
    private TelescopePinView.Evicted evictOverflow(UUID userId, Instant now, UUID protectedIslandId) {
        List<VisiblePin> visible = telescope.visiblePins(userId, now);
        int overflow = visible.size() - TelescopeService.MAX_PINS;
        if (overflow <= 0) {
            return null;
        }
        List<VisiblePin> dropped = visible.stream().filter(pin -> !protectedIslandId.equals(pin.row().getId()))
                .limit(overflow).toList();
        dropped.forEach(pin -> pins.deletePin(userId, pin.row().getId()));
        UUID last = dropped.get(dropped.size() - 1).row().getId();
        return new TelescopePinView.Evicted(last, groupQueryService.getGroup(last).getName());
    }

    /**
     * 핀이 만료되는 시각 — 넣은 1시간 버킷의 끝(다음 정시)이다. 목록 버킷과 같은 {@code truncatedTo(HOURS)} 라 핀은 그 버킷의
     * 무작위 섬과 함께 사라진다. 정시 정각에 넣으면 그 시각이 버킷 시작이라 1시간 뒤다.
     */
    static Instant nextReset(Instant now) {
        return now.truncatedTo(ChronoUnit.HOURS).plus(1, ChronoUnit.HOURS);
    }
}
