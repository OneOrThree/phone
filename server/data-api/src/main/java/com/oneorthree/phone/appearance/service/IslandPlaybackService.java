package com.oneorthree.phone.appearance.service;

import static com.oneorthree.phone.appearance.service.AppearanceService.decode;
import static com.oneorthree.phone.appearance.service.AppearanceService.receiptEvents;
import static com.oneorthree.phone.appearance.service.AppearanceService.requireCarrier;
import static com.oneorthree.phone.appearance.service.AppearanceService.semantic;
import static com.oneorthree.phone.appearance.service.AppearanceService.tree;

import com.fasterxml.jackson.databind.node.ObjectNode;
import com.oneorthree.phone.appearance.dto.AppearanceCommandView;
import com.oneorthree.phone.appearance.dto.PlaybackView;
import com.oneorthree.phone.appearance.exception.AppearanceErrorCode;
import com.oneorthree.phone.appearance.exception.AppearanceException;
import com.oneorthree.phone.appearance.repository.AudioTrackRepository;
import com.oneorthree.phone.appearance.repository.CatalogAssetRepository;
import com.oneorthree.phone.appearance.repository.IslandPlaybackRepository;
import com.oneorthree.phone.appearance.repository.OwnedProductRepository;
import com.oneorthree.phone.appearance.repository.domain.AudioTrack;
import com.oneorthree.phone.appearance.repository.domain.CatalogAsset;
import com.oneorthree.phone.appearance.repository.domain.IslandPlayback;
import com.oneorthree.phone.construction.service.IslandFacilityQueryService;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.outbox.dto.PublicCommandReceipt;
import com.oneorthree.phone.outbox.dto.PublicCommandRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandResult;
import com.oneorthree.phone.outbox.service.PublicCommandService;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 공용 음악(방송기) 재생 상태 — GET·PATCH {@code /islands/{islandId}/playback} (GROMO-1779,
 * island-playback 정책 M01~M10 · LLD §2~§6).
 *
 * <p>권한은 「활성 주민 + 완공된 방송기(gram)」다. 같은 섬 주민 누구나 곡·재생을 바꾼다(방장 승인 없음,
 * M02). 곡은 섬이 실제 소유한 {@code audio} 상품만 고를 수 있고 소유 확인과 변경은 같은 TX 다(M03).
 *
 * <p>잠금 순서(LLD §4) — caller → receipt → groups(배타) → membership(공유) → 보유 행(공유) → 재생 행(배타).
 * 재생 행 잠금이 곧 version 발급 직렬화다(외양 행과 같은 방식). 서버 시각은 재생 행을 잠근 뒤 한 번만
 * 읽고 {@code t = max(now, 이전 anchor)} 로 역행을 막는다.
 *
 * <h2>playback.updated 생산 게이트 — {@code island-playback.events-enabled} (기본 OFF)</h2>
 * LLD §5: durationSeconds 가 붙은 확장 사건은 1754 payload 계약·1755 validator/adapter·앱의 곡 길이
 * 처리가 동기화되기 전에 생산하지 않는다. 그래서 끈 동안에는 실제 변경에도 outbox 행을 쓰지 않고
 * receipt 의 events 는 빈 배열이다. 선행 조건이 끝나면 배포 설정으로만 켠다.
 */
@Slf4j
@Service
public class IslandPlaybackService {

    private static final Set<String> FIELDS = Set.of("trackId", "playing");
    /** 공개 version 은 JS 안전 정수 범위다(정책: 양의 JS 안전 정수). */
    private static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;

    private final UserQueryService users;
    private final GroupQueryService groups;
    private final GroupMemberRepository members;
    private final IslandFacilityQueryService facilities;
    private final CatalogAssetRepository catalogAssets;
    private final OwnedProductRepository ownedProducts;
    private final AudioTrackRepository audioTracks;
    private final IslandPlaybackRepository playbacks;
    private final PublicCommandService publicCommands;
    private final AppearanceEvents events;
    private final Clock clock;
    private final boolean eventsEnabled;

    public IslandPlaybackService(UserQueryService users, GroupQueryService groups,
            GroupMemberRepository members, IslandFacilityQueryService facilities,
            CatalogAssetRepository catalogAssets, OwnedProductRepository ownedProducts,
            AudioTrackRepository audioTracks, IslandPlaybackRepository playbacks,
            PublicCommandService publicCommands,
            AppearanceEvents events, Clock clock,
            @Value("${island-playback.events-enabled:false}") boolean eventsEnabled) {
        this.users = users;
        this.groups = groups;
        this.members = members;
        this.facilities = facilities;
        this.catalogAssets = catalogAssets;
        this.ownedProducts = ownedProducts;
        this.audioTracks = audioTracks;
        this.playbacks = playbacks;
        this.publicCommands = publicCommands;
        this.events = events;
        this.clock = clock;
        this.eventsEnabled = eventsEnabled;
    }

    // ---------------------------------------------------------------- GET

    /**
     * 현재 재생 상태 — 저장된 anchor(p, effectiveAt)를 그대로 돌려준다. 현재 위치로 다시 계산해 옛
     * anchor 를 붙이면 앱이 경과를 두 번 더한다(LLD §3). 행이 없으면 초기 상태(M08)이며 GET 은 행도
     * 사건도 만들지 않는다.
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PlaybackView get(UUID islandId, UUID userId) {
        User viewer = users.getCaller(userId);
        Group island = aliveIsland(groups.findGroup(islandId).orElse(null));
        members.findByUserAndGroup(viewer, island)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));
        requireGram(islandId);
        Instant now = clock.instant();
        return playbacks.findById(islandId)
                .map(p -> view(p, now))
                .orElseGet(() -> new PlaybackView(null, false, 0, initialAnchor(island).toString(),
                        null, 0, now.toString(), null));
    }

    // ---------------------------------------------------------------- PATCH

    /**
     * 재생 변경 — {@code trackId}·{@code playing} 중 최소 하나 + {@code expectedVersion}. 멱등 계층이
     * receipt 선점·재생을 맡고, 본체는 잠금 아래 소유·version 을 검증한 뒤 LLD §3 전이표를 적용한다.
     * 실패 명령은 receipt 를 남기지 않는다.
     */
    @Transactional
    public AppearanceCommandView<PlaybackView> patch(UUID islandId, UUID userId, UUID idempotencyKey,
                                                     List<String> fields, Map<String, Object> values,
                                                     Long expectedVersion) {
        requireCarrier(fields, values, FIELDS);
        String trackIn = values.containsKey("trackId") ? trackValue(values.get("trackId")) : null;
        Boolean playingIn = values.containsKey("playing") ? playingValue(values.get("playing")) : null;
        if (expectedVersion == null) {
            throw new AppearanceException(AppearanceErrorCode.INVALID_REQUEST);
        }
        if (expectedVersion < 0 || expectedVersion > MAX_SAFE_INTEGER) {
            throw new AppearanceException(AppearanceErrorCode.OUT_OF_RANGE);
        }
        // fingerprint 는 원래 제공한 필드만 — 생략 필드를 현재 상태로 채운 뒤 만들지 않는다(LLD §4).
        ObjectNode semantic = semantic(values);
        semantic.put("expectedVersion", expectedVersion);
        PublicCommandRequest command = new PublicCommandRequest(userId,
                "PATCH:/islands/" + islandId + "/playback", idempotencyKey, semantic);
        PublicCommandReceipt receipt = publicCommands.run(command,
                () -> users.getCallerForUpdate(userId),
                ignored -> requireAccessForUpdate(islandId, userId),
                () -> apply(islandId, userId, trackIn, playingIn, expectedVersion)).value();
        return new AppearanceCommandView<>(decode(receipt.data(), PlaybackView.class),
                receiptEvents(receipt));
    }

    private PublicCommandResult apply(UUID islandId, UUID userId, String trackIn, Boolean playingIn,
                                      long expectedVersion) {
        requireAccessForUpdate(islandId, userId);
        AudioTrack newTrack = trackIn == null ? null : requireOwnedTrack(islandId, trackIn);

        playbacks.insertIfAbsent(islandId);
        IslandPlayback playback = playbacks.findByIdForUpdate(islandId)
                .orElseThrow(() -> new IllegalStateException("재생 상태를 만든 직후에 찾지 못했습니다."));
        if (expectedVersion != playback.getVersion()) {
            throw new AppearanceException(AppearanceErrorCode.VERSION_CONFLICT);
        }

        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        Instant t = now;
        if (now.isBefore(playback.getEffectiveAt())) {
            log.warn("[playback] 서버 시계 역행 — anchor 를 유지한다 islandId={} backwardMs={}", islandId,
                    playback.getEffectiveAt().toEpochMilli() - now.toEpochMilli());
            t = playback.getEffectiveAt();
        }

        boolean changed = transition(playback, newTrack, playingIn, userId, t);
        List<Map<String, Object>> envelopes = changed && eventsEnabled
                ? List.of(events.playbackChanged(islandId, userId, playback.getVersion(),
                        payload(view(playback, t))))
                : List.of();
        log.info("[playback] command islandId={} outcome={} version={}", islandId,
                changed ? "changed" : "no-op", playback.getVersion());
        return new PublicCommandResult(200, tree(view(playback, t)), tree(envelopes));
    }

    /**
     * LLD §3 전이표. 곡 변경은 위치 0 + 요청 playing(생략이면 기존 유지), 같은 곡 재전송은 곡 변경이
     * 아니다. pause 는 {@code position(t)} 를 정수로 내려 고정하고 resume 은 저장 위치에서 다시 시작한다.
     * trackId 와 playing 을 함께 바꿔도 변경은 한 번(version +1)이다.
     *
     * @return 실제 변경이 있었으면 true
     */
    private boolean transition(IslandPlayback playback, AudioTrack newTrack, Boolean playingIn,
                               UUID actor, Instant t) {
        if (newTrack != null && !newTrack.getProductId().equals(playback.getTrackId())) {
            boolean playing = playingIn != null ? playingIn : playback.isPlaying();
            playback.change(newTrack.getProductId(), playing, 0, t, actor);
            return true;
        }
        if (playingIn == null || playingIn == playback.isPlaying()) {
            return false;
        }
        if (playback.getTrackId() == null) {
            // 곡 없이 재생 — 임의 곡을 고르지 않는다. (곡 없이 정지는 위 무변경 분기에서 끝났다)
            throw new AppearanceException(AppearanceErrorCode.STATE_CONFLICT);
        }
        long position = playback.positionAt(t, durationMillis(playback.getTrackId()));
        playback.change(playback.getTrackId(), playingIn, position, t, actor);
        return true;
    }

    // ---------------------------------------------------------------- 검증

    /**
     * 곡 검증 — 카탈로그에 없거나 음원이 아니거나 길이 메타데이터가 없으면 422(미지원 trackId),
     * 등록된 음원이지만 섬 미소유면 403. 보유 행은 공유 잠금 — 회수 writer 와 보유 행에서 직렬화된다.
     */
    private AudioTrack requireOwnedTrack(UUID islandId, String trackId) {
        CatalogAsset asset = catalogAssets.findById(trackId)
                .filter(a -> CatalogAsset.KIND_AUDIO.equals(a.getKind()))
                .orElseThrow(() -> new AppearanceException(AppearanceErrorCode.OUT_OF_RANGE));
        AudioTrack track = audioTracks.findById(asset.getProductId())
                .orElseThrow(() -> new AppearanceException(AppearanceErrorCode.OUT_OF_RANGE));
        if (ownedProducts.findIslandProductForShare(islandId, trackId).isEmpty()) {
            throw new AppearanceException(AppearanceErrorCode.FORBIDDEN);
        }
        return track;
    }

    /**
     * 명령·재생 공통 접근 — 섬 생존(배타) → 활성 주민(공유) → gram 완공. 재생(receipt replay)도 같은
     * 순서로 다시 본다 — 강퇴·탈퇴·gram 상태 변경 뒤 옛 결과를 되살리지 않는다(LLD §4).
     */
    private void requireAccessForUpdate(UUID islandId, UUID userId) {
        aliveIsland(groups.getGroupForUpdate(islandId));
        members.findActiveByUserIdAndGroupIdForShare(userId, islandId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));
        requireGram(islandId);
    }

    /** 방송기 미완공은 GET·PATCH 모두 403 GRAM_LOCKED — facility-gates.enforce 가 꺼져 있으면 통과. */
    private void requireGram(UUID islandId) {
        if (!facilities.hasGram(islandId)) {
            throw new AppearanceException(AppearanceErrorCode.GRAM_LOCKED);
        }
    }

    /** 초기 anchor — 섬 생성 시각, 비어 있는 옛 행은 epoch. {@code IslandPlaybackRepository#insertIfAbsent} 와 같은 값. */
    private static Instant initialAnchor(Group island) {
        return island.getCreatedAt() == null ? Instant.EPOCH : island.getCreatedAt();
    }

    private static Group aliveIsland(Group island) {
        if (island == null || island.getDeletedAt() != null || island.getStatus() == GroupStatus.ENDED) {
            throw new GroupException(GroupErrorCode.GROUP_NOT_FOUND);
        }
        return island;
    }

    /** trackId — 명시 null 은 곡 지우기 명령이 아니라 형식 오류(400)다. */
    private static String trackValue(Object value) {
        if (!(value instanceof String text)) {
            throw new AppearanceException(AppearanceErrorCode.INVALID_REQUEST);
        }
        return text;
    }

    private static Boolean playingValue(Object value) {
        if (!(value instanceof Boolean playing)) {
            throw new AppearanceException(AppearanceErrorCode.INVALID_REQUEST);
        }
        return playing;
    }

    // ---------------------------------------------------------------- 표현

    private int durationMillis(String trackId) {
        return audioTracks.findById(trackId)
                .orElseThrow(() -> new IllegalStateException("재생 중인 곡의 길이 메타데이터가 없습니다: " + trackId))
                .getDurationMillis();
    }

    private PlaybackView view(IslandPlayback p, Instant serverNow) {
        Double duration = p.getTrackId() == null ? null : durationMillis(p.getTrackId()) / 1000.0;
        return new PlaybackView(p.getTrackId(), p.isPlaying(), p.getPositionSeconds(),
                p.getEffectiveAt().toString(), Objects.toString(p.getChangedBy(), null),
                p.getVersion(), serverNow.toString(), duration);
    }

    /** 사건 payload — 공개 data 와 같은 8필드. null 이 들어가므로 Map.of 대신 LinkedHashMap 이다. */
    private static Map<String, Object> payload(PlaybackView view) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("trackId", view.trackId());
        payload.put("playing", view.playing());
        payload.put("positionSeconds", view.positionSeconds());
        payload.put("effectiveAt", view.effectiveAt());
        payload.put("changedBy", view.changedBy());
        payload.put("version", view.version());
        payload.put("serverNow", view.serverNow());
        payload.put("durationSeconds", view.durationSeconds());
        return payload;
    }
}
