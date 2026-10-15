package com.oneorthree.phone.character.dto;

import java.util.List;

/**
 * 누끼 이미지 유해성 검사 결과.
 *
 * <p>allowed=false 면 차단해야 한다. flaggedCategories 는 true 로 판정된 카테고리 목록
 * (예: sexual, sexual/minors, violence, self-harm 계열)이며, 통과 시엔 비어 있다.</p>
 *
 * <p>unavailable 은 <b>차단 사유</b>를 구분한다(GROMO-1197). 검사를 실제로 수행해 유해로 판정한
 * 경우와, 검사 자체를 못 해 fail-closed 로 막은 경우(키 미설정·타임아웃·5xx)는 둘 다
 * allowed=false 지만 사용자에게 할 말이 다르다 — 후자는 사진 잘못이 아니라 서버 사정이다.
 * 이 필드가 없던 동안 앱은 서버 장애까지 "이 사진으로는 캐릭터를 만들 수 없어요."로 안내했다.</p>
 */
public record ImageModerationResponse(
        boolean allowed,
        List<String> flaggedCategories,
        boolean unavailable
) {

    /**
     * 검사를 수행한 정상 판정.
     *
     * @param allowed           검사를 실제로 돌린 결과 통과했는지
     * @param flaggedCategories true 로 걸린 카테고리들. 통과 시엔 빈 목록
     * @return unavailable=false 로 고정된 응답 — 앱은 이 값을 보고 "사진 때문에 막혔다"고 안내한다
     */
    public static ImageModerationResponse judged(boolean allowed, List<String> flaggedCategories) {
        return new ImageModerationResponse(allowed, flaggedCategories, false);
    }

    /**
     * 검사 불가로 인한 fail-closed 차단.
     *
     * @return 막되 사유가 서버 사정임을 알리는 응답(allowed=false, unavailable=true).
     *         앱은 이때 사진 탓이 아니라 잠시 후 다시 시도하라고 안내해야 한다
     */
    public static ImageModerationResponse failClosed() {
        return new ImageModerationResponse(false, List.of(), true);
    }
}
