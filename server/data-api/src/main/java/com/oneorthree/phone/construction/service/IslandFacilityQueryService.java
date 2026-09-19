package com.oneorthree.phone.construction.service;

import com.oneorthree.phone.construction.repository.IslandFacilityRepository;
import com.oneorthree.phone.construction.repository.domain.ConstructionBuilding;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * 시설 완공 조회 — 전망대(섬 검색·이동 게이트, GROMO-1759)·우체통(우체통 편지방·편지
 * 게이트, GROMO-1775·1933)·게시판(섬 공지·댓글 게이트, GROMO-1771) 게이트의 유일한 판정 근거다.
 *
 * <p>종전에는 세 곳이 「건설 도메인 미구현」 pass-through stub 이었다 — 이 서비스의
 * 세 predicate 가 그 자리에 들어간다.
 *
 * <h2>롤아웃 가드 — {@code construction.facility-gates.enforce} (기본 OFF)</h2>
 * 섬 지갑에 물고기를 적립하는 경로(집중 보상 연동)는 아직 배포되지 않았다 —
 * {@code IslandWalletService.contribute} 는 호출부가 없는 서버 전용 진입점이다. 이 상태에서
 * 완공 게이트를 즉시 강제하면 어떤 섬도 시설을 지을 수 없어 기존 우체통 편지방·편지·섬
 * 검색/이동이 전부 403 이 된다. 그래서 게이트는 명시적 플래그 뒤에 둔다:
 * <ul>
 *   <li>{@code enforce=false}(기본) — 종전 stub 의 판정을 그대로 보존한다: 전망대·우체통
 *       게이트는 무조건 통과, 편지 게이트는 「살아 있는 소속 섬이 있는가」만 본다
 *       (섬이 하나도 없는 호출자는 예전과 같이 잠긴다). 기존 기능을 깨지 않는다.</li>
 *   <li>{@code enforce=true} — COMPLETED 시설만 연다. 자금 적립 경로가 배포돼 섬들이 실제로
 *       시설을 지을 수 있게 된 뒤에만 켠다.</li>
 * </ul>
 * 켤 때는 배포 설정에서만 바꾸면 되고, 적립 연동이 상시화되면 이 가드 자체를 지운다.
 */
@Service
@Transactional(readOnly = true)
public class IslandFacilityQueryService {

    private final IslandFacilityRepository facilities;
    private final boolean enforce;

    public IslandFacilityQueryService(IslandFacilityRepository facilities,
            @Value("${construction.facility-gates.enforce:false}") boolean enforce) {
        this.facilities = facilities;
        this.enforce = enforce;
    }

    /** 이 섬의 전망대가 완공됐는가 — 섬 검색 진입·이동 게이트({@code OBSERVATORY_LOCKED}). */
    public boolean hasObservatory(UUID islandId) {
        return !enforce || facilities.existsCompleted(islandId, ConstructionBuilding.TOWER.id());
    }

    /** 이 섬의 우체통이 완공됐는가 — 우체통 편지방 게이트({@code MAILBOX_LOCKED}). */
    public boolean hasMailbox(UUID islandId) {
        return !enforce || facilities.existsCompleted(islandId, ConstructionBuilding.MAIL.id());
    }

    /** 이 섬의 게시판이 완공됐는가 — 섬 게시판 공지·댓글 게이트({@code BOARD_LOCKED}, GROMO-1771). */
    public boolean hasBoard(UUID islandId) {
        return !enforce || facilities.existsCompleted(islandId, ConstructionBuilding.BOARD.id());
    }

    /** 이 섬의 방송기가 완공됐는가 — 공용 음악 조회·변경 게이트({@code FACILITY_LOCKED}, GROMO-1779). */
    public boolean hasGram(UUID islandId) {
        return !enforce || facilities.existsCompleted(islandId, ConstructionBuilding.GRAM.id());
    }

    /** 이 섬의 도서관이 완공됐는가 — 도서관 물고기 장 게이트({@code LIBRARY_LOCKED}, GROMO-1895). */
    public boolean hasLibrary(UUID islandId) {
        return !enforce || facilities.existsCompleted(islandId, ConstructionBuilding.LIBRARY.id());
    }

    /**
     * 주어진 섬들 중 우체통 완공 섬이 있는가 — 편지 게이트({@code LETTER_MAILBOX_LOCKED}).
     * 호출측이 「살아 있는 소속 섬」 목록을 걸러 넘겨야 종료된 섬의 완공 시설이 열리지 않는다.
     *
     * <p>{@code enforce=false} 일 때는 종전 stub 의 「살아 있는 소속 섬이 있는가」판정이 남는다 —
     * 섬이 하나도 없는 호출자는 적립 연동 전후와 무관하게 잠기는 기존 동작이다.
     */
    public boolean hasMailboxOnAnyOf(Collection<UUID> islandIds) {
        if (islandIds.isEmpty()) {
            return false;
        }
        return !enforce
                || facilities.existsCompletedInAny(ConstructionBuilding.MAIL.id(), List.copyOf(islandIds));
    }
}
