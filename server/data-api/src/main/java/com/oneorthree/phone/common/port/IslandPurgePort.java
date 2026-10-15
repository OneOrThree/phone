package com.oneorthree.phone.common.port;

import java.util.UUID;

/**
 * 섬이 닫히는 순간 공동 데이터를 함께 지우는 지점 (GROMO-1995).
 *
 * <p>정책(policy-2026-09-14): 「섬 삭제 시 섬 정보·설정, 공동 잔액·원장, 건물·건설 퀘스트, 공동
 * 구매·적용 내역, 섬 소속·공동 기록을 <b>함께 삭제</b>한다.」 종전 {@code Group.close()} 는
 * {@code status = ENDED} 한 컬럼만 바꿨고 공동 데이터는 전부 남았다.
 *
 * <p><b>왜 포트인가.</b> 섬이 닫히는 것을 아는 쪽은 {@code group}(L5)인데, 지울 대상은
 * {@code construction}(L6)·{@code appearance}(L7)·{@code quest}(L7)·{@code shop}(L8) 이 소유한다.
 * 도메인 높이 표(backend-layering §4, {@code DomainLayerRulesTest})가 아래에서 위로의 참조를 막으므로
 * 호출을 뒤집는다. 조합하는 구현의 자리는 L10 {@code internal} 이다.
 *
 * <p><b>왜 이벤트가 아닌가.</b> 삭제는 섬을 닫는 트랜잭션과 <b>같은 커밋</b>이어야 한다. 따로 커밋되면
 * 「섬은 닫혔는데 공동 잔액은 남은」 반쪽 상태가 생기고, 그 사이 정산·조회가 죽은 섬의 통장을 읽는다.
 * 자진 탈퇴의 내기 환불이 같은 트랜잭션에 있어야 하는 것과 같은 논증이다.
 */
public interface IslandPurgePort {

    /**
     * 섬의 공동 데이터를 지우고 섬에 삭제 묘비를 남긴다.
     *
     * <p>호출자 트랜잭션에 편승한다({@code MANDATORY}). 호출 시점에 그 섬의 {@code groups} 행은 이미
     * 잠겨 있어야 한다 — 삭제 대상이 그 잠금 뒤에서만 늘어난다.
     *
     * <p><b>개인 데이터는 건드리지 않는다</b> — 계정·고양이·닉네임·친구·개인 보유품·개인 집중 기록은
     * 정책이 「유지한다」고 못 박은 것들이다.
     *
     * @param islandId 닫힌 섬
     */
    void purgeIsland(UUID islandId);
}
