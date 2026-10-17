package com.oneorthree.phone.magazine.support;

import java.util.List;

/**
 * 편집부 페이지(첫 장 무료 칸 셋) — 발행 순간 고정해 {@code magazine_issues.editorial} 에 저장한다 (GROMO-2289, MAG-04).
 * 템플릿은 앱이 그리고 서버는 섬 이름·숫자와 소식만 채운다. 비공개로 바뀌었거나 닫힌 섬은 읽는 순간 뺀다.
 *
 * @param ranking    주간 섬 랭킹 1~3위(비공개 섬 제외)
 * @param newIslands 어제(KST 날짜) 새로 생긴 공개 섬, 먼저 만든 순 최대 3곳
 * @param note       편집부 소식 — 운영 문구가 없는 날은 몽돌 집중 팁 번호
 */
public record MagazineEditorial(List<Ranked> ranking, List<IslandCard> newIslands, Note note) {

    /** 랭킹 한 줄 — {@code rank} 는 비공개 섬을 뺀 순위(동점은 공동 순위)다. */
    public record Ranked(int rank, IslandCard island) {
    }

    /**
     * @param type  {@code EDITOR}(운영 문구) · {@code TIP}(몽돌 팁 — 문장은 앱 번역 파일에 있다)
     * @param body  운영 문구. TIP 이면 null
     * @param tipNo 몽돌 팁 번호(0부터). EDITOR 면 null
     */
    public record Note(String type, String body, Integer tipNo) {

        public static Note editor(String body) {
            return new Note("EDITOR", body, null);
        }

        public static Note tip(int tipNo) {
            return new Note("TIP", null, tipNo);
        }
    }
}
