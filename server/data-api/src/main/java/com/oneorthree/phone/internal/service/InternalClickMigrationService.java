package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.internal.dto.FrozenClickCandidateResponse;
import com.oneorthree.phone.internal.dto.FrozenPageResponse;
import com.oneorthree.phone.internal.dto.MigrationManifestResponse;
import com.oneorthree.phone.invitelink.exception.InviteLinkErrorCode;
import com.oneorthree.phone.invitelink.exception.InviteLinkException;
import com.oneorthree.phone.invitelink.repository.FrozenClickProjection;
import com.oneorthree.phone.invitelink.repository.FrozenLinkProjection;
import com.oneorthree.phone.invitelink.repository.GroupInviteLinkRepository;
import com.oneorthree.phone.invitelink.repository.InviteClickFrozenRowRepository;
import com.oneorthree.phone.invitelink.repository.InviteClickMigrationRepository;
import com.oneorthree.phone.invitelink.repository.InviteLinkClickRepository;
import com.oneorthree.phone.invitelink.repository.InviteLinkFrozenRowRepository;
import com.oneorthree.phone.invitelink.repository.ManifestEntry;
import com.oneorthree.phone.invitelink.repository.domain.InviteClickFrozenRow;
import com.oneorthree.phone.invitelink.repository.domain.InviteClickMigration;
import com.oneorthree.phone.invitelink.repository.domain.InviteClickMigrationStatus;
import com.oneorthree.phone.invitelink.repository.domain.InviteLinkFrozenRow;
import com.oneorthree.phone.invitelink.support.FrozenClickSource;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * 클릭 이관의 Data 쪽 — <b>정지 스냅샷 확정 · read-only export · import 종료</b> (서비스 §7.2 · A22 ㋮ · ㊥).
 *
 * <h2>Data 는 소진하지 않는다</h2>
 * 매치는 읽기가 아니라 <b>소진(쓰기)</b> 이고, 정지 창에도 쓰기 원장은 Neon 하나다(㊥). 양쪽에서
 * 소진하면 잠금이 공유되지 않아 <b>같은 클릭이 두 기기에 배정</b>된다. 그래서 여기에는 소진 상태를
 * 바꾸는 경로가 없다 — 스냅샷을 만들고, 읽어 주고, 닫는 것이 전부다.
 *
 * <h2>폐기 상태를 «확정해서» 옮긴다</h2>
 * {@code group_invite_links} 에는 폐기 컬럼이 없고 만료 판정이 <b>런타임 코어 조회</b>다(ⓙ) —
 * 그대로 복사하면 죽은 slug 가 되살아난다. 그래서 정지 시점에 「발급자가 아직 활성 멤버인가 ·
 * 그룹이 살아 있는가」를 보고 {@code linkStatus} 를 <b>여기서 확정</b>한다.
 *
 * <h2>시각 커서를 쓰지 않는다</h2>
 * {@code invite_link_clicks} 에는 {@code updated_at} 이 없고, 상태 변경 시각은 커밋 순서를 보장하지
 * 않아 늦게 커밋된 전이를 영구히 건너뛴다(㋖). 그래서 <b>구 쓰기 정지 뒤 전체 스캔</b>이다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class InternalClickMigrationService {

    /** 한 번에 읽을 원재료 행 수. 스냅샷은 한 트랜잭션이라 너무 크게 잡으면 그만큼 오래 잠근다. */
    private static final int SCAN_PAGE_SIZE = 500;

    /** export 한 페이지의 상한 — importer 배치 크기(20)보다 넉넉하되 응답이 비대해지지 않게. */
    private static final int EXPORT_PAGE_SIZE = 200;

    /** UUID 최소값 — 첫 페이지의 커서다. */
    private static final String FIRST_CURSOR = "00000000-0000-0000-0000-000000000000";

    private final InviteLinkClickRepository inviteLinkClickRepository;
    private final GroupInviteLinkRepository groupInviteLinkRepository;
    private final InviteClickMigrationRepository inviteClickMigrationRepository;
    private final InviteClickFrozenRowRepository inviteClickFrozenRowRepository;
    private final InviteLinkFrozenRowRepository inviteLinkFrozenRowRepository;
    private final Clock clock;

    /**
     * 정지 스냅샷을 확정한다 — <b>한 트랜잭션</b>이다.
     *
     * <p>같은 {@code migrationId} 로 다시 부르면 <b>아무것도 하지 않는다</b>. 스냅샷은 「그 시점의
     * 사실」이라 다시 뜨면 다른 값이 되고, 그러면 이미 그 체크섬으로 반영된 Neon 행이 전부
     * {@code FROZEN_SOURCE_CHANGED} 로 막힌다.
     *
     * @param migrationId 이관 회차 이름
     * @return 담긴 행 수
     */
    @Transactional
    public FreezeResult freeze(String migrationId) {
        Optional<InviteClickMigration> existing = inviteClickMigrationRepository.findById(migrationId);
        if (existing.isPresent()) {
            InviteClickMigration run = existing.get();
            log.info("이관 회차가 이미 정지돼 있다 — migrationId={} clicks={} links={}",
                    migrationId, run.getRowCount(), run.getLinkCount());
            return new FreezeResult(run.getRowCount(), run.getLinkCount());
        }

        int clicks = freezeClicks(migrationId);
        int links = freezeLinks(migrationId);

        // manifest 는 «스냅샷을 뜬 순간»에 확정한다. 요청마다 다시 세면 그 사이 들어온 행이 섞여,
        // 이미 그 값으로 import 를 시작한 링크 서버가 MANIFEST_CHANGED 로 통째로 막힌다.
        inviteClickMigrationRepository.save(InviteClickMigration.builder()
                .migrationId(migrationId)
                .status(InviteClickMigrationStatus.FROZEN)
                .frozenAt(clock.instant())
                .rowCount(clicks)
                .sourceChecksum(manifestChecksum("clickId",
                        inviteClickFrozenRowRepository.findManifest(migrationId)))
                .linkCount(links)
                .linkChecksum(manifestChecksum("linkId",
                        inviteLinkFrozenRowRepository.findManifest(migrationId)))
                .build());
        log.info("이관 정지 스냅샷 확정 — migrationId={} clicks={} links={}", migrationId, clicks, links);
        return new FreezeResult(clicks, links);
    }

    private int freezeClicks(String migrationId) {
        String cursor = FIRST_CURSOR;
        int total = 0;
        while (true) {
            List<FrozenClickProjection> page =
                    inviteLinkClickRepository.findFrozenSourcePage(cursor, SCAN_PAGE_SIZE);
            if (page.isEmpty()) {
                break;
            }
            List<InviteClickFrozenRow> rows = new ArrayList<>(page.size());
            for (FrozenClickProjection row : page) {
                Map<String, Object> source = FrozenClickSource.canonicalize(toSource(row));
                rows.add(InviteClickFrozenRow.builder()
                        .migrationId(migrationId)
                        .clickId(row.getClickId())
                        .slug(row.getSlug())
                        .groupId(row.getGroupId())
                        .ipHash(row.getIpHash())
                        .os(row.getOs())
                        .clickedAt(row.getClickedAt())
                        .matched(row.getMatched())
                        .frozenSource(source)
                        .sourceChecksum(FrozenClickSource.checksum(source))
                        .build());
            }
            inviteClickFrozenRowRepository.saveAll(rows);
            total += rows.size();
            cursor = page.get(page.size() - 1).getClickId().toString();
        }
        return total;
    }

    /**
     * 링크 원장을 통째로 담는다 — <b>클릭이 한 번도 없던 slug 도</b> (A22 ㊏).
     *
     * <p>클릭 스냅샷의 링크 필드로 역산하면 그런 slug 가 빠진다. 그 링크는 이미 공유돼 있고,
     * 전환 직후 눌리면 링크 서버에 원장이 없어 실패한다 — 되돌릴 수 없는 실패다.
     */
    private int freezeLinks(String migrationId) {
        String cursor = FIRST_CURSOR;
        int total = 0;
        while (true) {
            List<FrozenLinkProjection> page =
                    groupInviteLinkRepository.findFrozenSourcePage(cursor, SCAN_PAGE_SIZE);
            if (page.isEmpty()) {
                break;
            }
            List<InviteLinkFrozenRow> rows = new ArrayList<>(page.size());
            for (FrozenLinkProjection row : page) {
                Map<String, Object> source = FrozenClickSource.canonicalizeLink(toLinkSource(row));
                rows.add(InviteLinkFrozenRow.builder()
                        .migrationId(migrationId)
                        .linkId(row.getLinkId())
                        .slug(row.getSlug())
                        .groupId(row.getGroupId())
                        .inviterId(row.getInviterId())
                        .frozenSource(source)
                        .sourceChecksum(FrozenClickSource.checksum(source))
                        .build());
            }
            inviteLinkFrozenRowRepository.saveAll(rows);
            total += rows.size();
            cursor = page.get(page.size() - 1).getLinkId().toString();
        }
        return total;
    }

    private static String manifestChecksum(String idField, List<ManifestEntry> entries) {
        List<FrozenClickSource.ManifestPair> pairs = new ArrayList<>(entries.size());
        for (ManifestEntry entry : entries) {
            pairs.add(new FrozenClickSource.ManifestPair(entry.getId().toString(), entry.getChecksum()));
        }
        return FrozenClickSource.manifestChecksum(idField, pairs);
    }

    /**
     * 이관 회차의 manifest — importer 가 배치마다 <b>같은 값 전체</b>를 실어 보낸다.
     *
     * @param migrationId 이관 회차
     * @return 기대 건수와 두 체크섬
     * @throws InviteLinkException {@code MIGRATION_NOT_FOUND}(404)
     */
    @Transactional(readOnly = true)
    public MigrationManifestResponse manifest(String migrationId) {
        InviteClickMigration migration = inviteClickMigrationRepository.findById(migrationId)
                .orElseThrow(() -> new InviteLinkException(InviteLinkErrorCode.MIGRATION_NOT_FOUND));
        return new MigrationManifestResponse(
                migration.getMigrationId(),
                migration.getRowCount(),
                migration.getSourceChecksum(),
                migration.getLinkCount(),
                migration.getLinkChecksum(),
                migration.getStatus() == InviteClickMigrationStatus.IMPORT_CLOSED);
    }

    /**
     * 클릭 스냅샷 벌크 export — <b>{@code clickId} 오름차순</b>.
     *
     * @param migrationId 이관 회차
     * @param cursor      직전 페이지의 마지막 clickId
     * @param limit       최대 건수
     * @return 한 페이지
     */
    @Transactional(readOnly = true)
    public FrozenPageResponse exportClicks(String migrationId, String cursor, Integer limit) {
        requireFrozen(migrationId);
        int pageSize = pageSizeOf(limit);
        List<InviteClickFrozenRow> rows = inviteClickFrozenRowRepository.findPage(
                migrationId, cursor == null || cursor.isBlank() ? FIRST_CURSOR : cursor, pageSize);
        List<FrozenClickCandidateResponse> items = new ArrayList<>(rows.size());
        for (InviteClickFrozenRow row : rows) {
            items.add(new FrozenClickCandidateResponse(row.getFrozenSource(), row.getSourceChecksum()));
        }
        String next = rows.size() < pageSize ? null : rows.get(rows.size() - 1).getClickId().toString();
        return new FrozenPageResponse(items, next);
    }

    /**
     * 링크 스냅샷 벌크 export — <b>{@code linkId} 오름차순</b>. 클릭이 없는 slug 도 여기 있다(㊏).
     *
     * @param migrationId 이관 회차
     * @param cursor      직전 페이지의 마지막 linkId
     * @param limit       최대 건수
     * @return 한 페이지
     */
    @Transactional(readOnly = true)
    public FrozenPageResponse exportLinks(String migrationId, String cursor, Integer limit) {
        requireFrozen(migrationId);
        int pageSize = pageSizeOf(limit);
        List<InviteLinkFrozenRow> rows = inviteLinkFrozenRowRepository.findPage(
                migrationId, cursor == null || cursor.isBlank() ? FIRST_CURSOR : cursor, pageSize);
        List<FrozenClickCandidateResponse> items = new ArrayList<>(rows.size());
        for (InviteLinkFrozenRow row : rows) {
            items.add(new FrozenClickCandidateResponse(row.getFrozenSource(), row.getSourceChecksum()));
        }
        String next = rows.size() < pageSize ? null : rows.get(rows.size() - 1).getLinkId().toString();
        return new FrozenPageResponse(items, next);
    }

    private static int pageSizeOf(Integer limit) {
        return limit == null || limit <= 0 ? EXPORT_PAGE_SIZE : Math.min(limit, EXPORT_PAGE_SIZE);
    }

    /**
     * 스냅샷이 있고 아직 닫히지 않았는지.
     *
     * <p>벌크 export 도 {@code IMPORT_CLOSED} 뒤에는 막는다 — 그 뒤의 import 는 이미 소진된 Neon
     * 상태를 구 스냅샷으로 덮는 경로이고, 그 창을 닫는 것이 5단계의 목적이다.
     */
    private void requireFrozen(String migrationId) {
        InviteClickMigration migration = inviteClickMigrationRepository.findById(migrationId)
                .orElseThrow(() -> new InviteLinkException(InviteLinkErrorCode.MIGRATION_NOT_FOUND));
        if (migration.getStatus() == InviteClickMigrationStatus.IMPORT_CLOSED) {
            throw new InviteLinkException(InviteLinkErrorCode.IMPORT_CLOSED);
        }
    }

    /**
     * 정지 스냅샷 확정 결과.
     *
     * @param clicks 담긴 클릭 수
     * @param links  담긴 링크 수 — 클릭이 없는 slug 도 포함한다
     */
    public record FreezeResult(int clicks, int links) {
    }

    /**
     * 호환 매치의 <b>후보</b>를 돌려준다 — read-only 다.
     *
     * <p>3시간 창 판정과 「이미 소진됐는가」는 여기서 걸러 주지 않는다. 걸러 주면 Neon 이 이미 소진한
     * 행을 구 DB 기준으로 되살릴 수 있다 — 소진의 판정자는 쓰기 원장 하나뿐이다(㊥).
     *
     * @param migrationId 이관 회차
     * @param ipHash      기존 salt 로 만든 해시(ⓕ)
     * @param os          {@code ios} · {@code android} · {@code other}
     * @return 원본 + 체크섬 쌍
     * @throws InviteLinkException {@code MIGRATION_NOT_FOUND}(404) · {@code IMPORT_CLOSED}(409)
     */
    @Transactional(readOnly = true)
    public List<FrozenClickCandidateResponse> exportCandidates(String migrationId, String ipHash, String os) {
        InviteClickMigration migration = inviteClickMigrationRepository.findById(migrationId)
                .orElseThrow(() -> new InviteLinkException(InviteLinkErrorCode.MIGRATION_NOT_FOUND));
        if (migration.getStatus() == InviteClickMigrationStatus.IMPORT_CLOSED) {
            // 5단계로 넘어갔다. 여기서 후보를 계속 주면 늦은 백필이 이미 소진된 Neon 상태를 덮는다.
            throw new InviteLinkException(InviteLinkErrorCode.IMPORT_CLOSED);
        }
        List<InviteClickFrozenRow> rows =
                inviteClickFrozenRowRepository.findCandidates(migrationId, ipHash, os);
        List<FrozenClickCandidateResponse> candidates = new ArrayList<>(rows.size());
        for (InviteClickFrozenRow row : rows) {
            candidates.add(new FrozenClickCandidateResponse(row.getFrozenSource(), row.getSourceChecksum()));
        }
        return candidates;
    }

    /**
     * importer 쓰기를 닫는다 — <b>되돌리지 않는다</b> (§7.2 5단계).
     *
     * @param migrationId 이관 회차
     * @throws InviteLinkException {@code MIGRATION_NOT_FOUND}(404)
     */
    @Transactional
    public void closeImport(String migrationId) {
        InviteClickMigration migration = inviteClickMigrationRepository.findById(migrationId)
                .orElseThrow(() -> new InviteLinkException(InviteLinkErrorCode.MIGRATION_NOT_FOUND));
        if (migration.close(clock.instant())) {
            log.info("이관 import 종료 — migrationId={}", migrationId);
        }
    }

    /**
     * 원재료 한 행 → 링크 서버의 {@code FrozenClick} 24필드.
     *
     * <p><b>{@code linkStatus} 는 여기서 확정한다</b>(ⓙ). 발급자가 더 이상 활성 멤버가 아니거나 그룹이
     * 닫혔으면 폐기다. 그때의 {@code revokedAt} 은 <b>멤버십 행이 마지막으로 바뀐 시각</b>을 쓴다 —
     * Data 에는 폐기 시각 컬럼이 없고, 그 전이가 폐기를 만든 사건이기 때문이다. 정확한 시각이 아니라
     * <b>증거로 남길 수 있는 가장 가까운 사실</b>이고, 링크 서버는 이 값을 순서 판정에 쓰지 않는다
     * (순서는 {@code membershipEpoch}·{@code transitionSeq} 가 갖는다).
     *
     * <p>{@code linkVersion} 은 <b>발급 당시</b> 세대여야 하지만 Data 는 그 값을 보관한 적이 없다.
     * 현재 세대를 싣고, 폐기로 확정된 링크는 어차피 재사용되지 않으므로 그 차이가 매치에 영향을 주지
     * 않는다 — 이것이 ⓙ 가 「상태를 확정해서 옮긴다」로 푸는 이유다.
     */
    private Map<String, Object> toLinkSource(FrozenLinkProjection row) {
        boolean groupClosed = row.getGroupDeletedAt() != null || "ENDED".equals(row.getGroupStatus());
        boolean inviterActive = Boolean.FALSE.equals(row.getInviterLeft());
        boolean revoked = groupClosed || !inviterActive;
        long epoch = row.getMembershipEpoch() == null ? 1L : row.getMembershipEpoch();
        long transitionSeq = row.getTransitionSeq() == null ? 0L : row.getTransitionSeq();

        Map<String, Object> source = new LinkedHashMap<>();
        source.put("linkId", row.getLinkId().toString());
        source.put("slug", row.getSlug());
        source.put("groupId", row.getGroupId().toString());
        source.put("inviterId", row.getInviterId().toString());
        source.put("linkVersion", Long.toString(epoch));
        source.put("membershipEpoch", Long.toString(epoch));
        source.put("transitionSeq", Long.toString(transitionSeq));
        source.put("groupName", row.getGroupName());
        source.put("inviterName", row.getInviterName());
        String displayVersion = Long.toString(row.getSnapshotVersion() == null ? 0L : row.getSnapshotVersion());
        source.put("groupNameVersion", displayVersion);
        source.put("inviterNameVersion", displayVersion);
        source.put("groupClosed", groupClosed);
        source.put("linkStatus", revoked ? "REVOKED" : "ACTIVE");
        source.put("linkCreatedAt", FrozenClickSource.timestamp(row.getLinkCreatedAt()));
        source.put("revokedAt", revoked
                ? FrozenClickSource.timestamp(
                        row.getMembershipUpdatedAt() == null ? row.getLinkCreatedAt() : row.getMembershipUpdatedAt())
                : null);
        if (source.get("groupName") == null) {
            throw new IllegalStateException("정지 원본 불일치 — 그룹명이 없다: link=" + row.getLinkId());
        }
        return source;
    }

    private Map<String, Object> toSource(FrozenClickProjection row) {
        boolean groupClosed = row.getGroupDeletedAt() != null || "ENDED".equals(row.getGroupStatus());
        boolean inviterActive = Boolean.FALSE.equals(row.getInviterLeft());
        boolean revoked = groupClosed || !inviterActive;
        long epoch = row.getMembershipEpoch() == null ? 1L : row.getMembershipEpoch();
        long transitionSeq = row.getTransitionSeq() == null ? 0L : row.getTransitionSeq();

        Map<String, Object> source = new LinkedHashMap<>();
        source.put("clickId", row.getClickId().toString());
        source.put("linkId", row.getLinkId().toString());
        source.put("slug", row.getSlug());
        source.put("groupId", row.getGroupId().toString());
        source.put("inviterId", row.getInviterId().toString());
        // 세대 셋은 «문자열»이다 — 링크 쪽 version() 이 문자열을 돌려주고, 그 모양이 체크섬의 일부다.
        source.put("linkVersion", Long.toString(epoch));
        source.put("membershipEpoch", Long.toString(epoch));
        source.put("transitionSeq", Long.toString(transitionSeq));
        source.put("groupName", row.getGroupName());
        source.put("inviterName", row.getInviterName());
        String displayVersion = Long.toString(row.getSnapshotVersion() == null ? 0L : row.getSnapshotVersion());
        source.put("groupNameVersion", displayVersion);
        source.put("inviterNameVersion", displayVersion);
        source.put("groupClosed", groupClosed);
        source.put("linkStatus", revoked ? "REVOKED" : "ACTIVE");
        source.put("linkCreatedAt", FrozenClickSource.timestamp(row.getLinkCreatedAt()));
        source.put("revokedAt", revoked
                ? FrozenClickSource.timestamp(
                        row.getMembershipUpdatedAt() == null ? row.getLinkCreatedAt() : row.getMembershipUpdatedAt())
                : null);
        source.put("ipHash", row.getIpHash());
        source.put("os", row.getOs());
        source.put("userAgent", row.getUserAgent());
        source.put("clickedAt", FrozenClickSource.timestamp(row.getClickedAt()));
        source.put("matched", row.getMatched());
        source.put("matchedAt", FrozenClickSource.timestamp(row.getMatchedAt()));
        source.put("matchedDeviceId", row.getMatchedDeviceId());
        source.put("appInstanceId", row.getAppInstanceId());
        source.put("claimedUserId", row.getClaimedUserId() == null ? null : row.getClaimedUserId().toString());
        source.put("claimedAt", FrozenClickSource.timestamp(row.getClaimedAt()));
        validate(row.getClickId(), source);
        return source;
    }

    /**
     * 링크 쪽 {@code frozen()} 이 거절하는 조합을 <b>여기서</b> 잡는다.
     *
     * <p>정지 스냅샷을 만드는 순간 드러내지 않으면, 같은 결함이 이관 당일에 전량 400 으로 나타난다.
     * 한 행이라도 어긋나면 회차 전체를 실패시킨다 — 「일부만 담긴 스냅샷」은 검증을 닫을 수 없다.
     */
    private void validate(UUID clickId, Map<String, Object> source) {
        boolean matched = Boolean.TRUE.equals(source.get("matched"));
        if (matched != (source.get("matchedAt") != null)) {
            throw new IllegalStateException("정지 원본 불일치 — matched 와 matchedAt 이 어긋난다: " + clickId);
        }
        if (source.get("claimedUserId") != null && source.get("claimedAt") == null) {
            throw new IllegalStateException("정지 원본 불일치 — 귀속은 있는데 시각이 없다: " + clickId);
        }
        if (!List.of("ios", "android", "other").contains(source.get("os"))) {
            throw new IllegalStateException("정지 원본 불일치 — 알 수 없는 os: " + clickId);
        }
        if (source.get("groupName") == null) {
            // 링크 쪽 text() 는 null 을 거절한다. 그룹명은 NOT NULL 이라 여기 걸리면 조인이 잘못된 것이다.
            throw new IllegalStateException("정지 원본 불일치 — 그룹명이 없다: " + clickId);
        }
    }
}
