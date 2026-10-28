package com.oneorthree.business.upstream.data.dto;

import java.util.List;
import java.util.UUID;

/**
 * 도서관 물고기 장 — 주민별 누적 획득의 상류 응답 (GROMO-1895, island-records LLD §7). Data 의
 * {@code IslandFishEarningsView} 와 같은 모양이고 공개 모양도 이것 그대로다(투영하지 않는다).
 *
 * <p>현재 활성 주민 <b>전원</b>이 한 번에 실린다 — 섬 정원 상한 안이라 페이지가 없다. 정렬·모수(탈퇴 계정 제외)와
 * 도서관 완공 게이트는 전부 Data 가 정한다.
 *
 * <p><b>잔액이 아니라 기록이다.</b> 재화는 섬 단위 하나이고 개인 물고기 지갑은 없지만(정책 「물고기 재화와 기록」),
 * 「누가 이 섬에서 얼마를 낚아 왔는가」는 구매·건설로 잔액이 줄어도 줄지 않는 별도 기록이다.
 */
public record IslandFishEarnings(List<Member> members) {

    /**
     * 주민 한 명의 이 섬 누적 획득 — 떠났다 돌아온 주민은 이전 소속 기간의 획득도 합친다. 다른 섬에서 낚은
     * 물고기는 들어가지 않는다.
     *
     * <p>{@code earnedFish} 는 {@code Long} 이다 — 상류가 필드를 빠뜨리면 「0마리 낚았다」로 읽히는 값을
     * 지어내는 대신 502 가 되어야 한다.
     */
    public record Member(UUID userId, String name, Long earnedFish) {
    }
}
