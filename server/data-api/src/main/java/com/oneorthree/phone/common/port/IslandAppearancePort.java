package com.oneorthree.phone.common.port;

import java.util.UUID;

/**
 * 시설 완공이 공동 외양에 반영되는 지점 (GROMO-1783 · GROMO-1656).
 *
 * <p><b>왜 포트인가.</b> 완공은 {@code construction} 이 아는 사실이고 공동 외양은 {@code appearance}
 * 의 데이터라 방향은 {@code appearance → construction} 여야 한다. 그런데 새 건물의 {@code default}
 * 반영은 <b>완공 트랜잭션 안에서</b> 일어나야 한다 — 따로 커밋되면 완공됐는데 외양 대상에 없는
 * 창이 생기고, 그 사이 PATCH 는 미등록 건물로 422 를 낸다. 호출을 뒤집기 위해 포트를 둔다.
 *
 * <p><b>왜 이벤트가 아닌가.</b> island.appearance.updated 의 버전 순서가 완공 커밋과 같은 TX 안에서
 * 정해져야 한다 — 비동기면 「완공 사건은 갔는데 외양 대상이 아직 없다」를 소비자가 본다.
 *
 * <p>구현: {@code appearance/service/AppearanceService}. 호출자 TX 에 편승하므로(MANDATORY)
 * 별도 잠금 순서를 만들지 않는다 — 완공 TX 가 이미 잡은 섬 잠금 뒤에 외양 행을 잠근다.
 */
public interface IslandAppearancePort {

    /**
     * 완공된 건물을 공동 외양 전체 맵에 {@code default} 로 추가한다 — 맵에 없는 키는
     * 외양 대상이 아니라는 뜻이므로, 이 호출 없이 커밋되면 그 건물은 테마를 받을 수 없다.
     *
     * @param islandId   완공된 시설의 섬
     * @param buildingId 방금 완공된 건물
     * @param actorId    사건의 주체로 기록할 유저 — 완공 시설을 시작한 주민
     */
    void buildingCompleted(UUID islandId, String buildingId, UUID actorId);
}
