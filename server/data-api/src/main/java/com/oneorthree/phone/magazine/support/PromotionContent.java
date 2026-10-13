package com.oneorthree.phone.magazine.support;

import com.oneorthree.phone.magazine.exception.MagazineErrorCode;
import com.oneorthree.phone.magazine.exception.MagazineException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 홍보 칸 내용 — 한 줄 글과 배치 (GROMO-2289, 잡지 구현 계획 §2-3). 앱 ↔ 서버가 주고받는 요청 본문이 곧 이 모양이고,
 * 검증을 마친 {@link Layout} 이 {@code island_promotions.layout}(jsonb)에 그대로 들어간다.
 *
 * <h2>좌표계 — 칸 기준 정규화 좌표</h2>
 * 칸 왼쪽 위가 (0, 0), 오른쪽 아래가 (1, 1)이다. {@code x}·{@code y} 는 재료의 가운데 점이고, 칸 둘레 8%까지 걸칠 수
 * 있다(-0.08~1.08). {@code scale} 은 스티커 너비 ÷ 칸 너비(0.06~0.6), {@code rotation} 은 도(-180~180)다. 겹침 순서는
 * 배열 순서다 — 뒤쪽이 위에 그려지고 별도 z 필드가 없다. 테이프는 0~1개이고 가운데 점이 테두리 띠(가장자리 8% 안쪽)
 * 위에 있어야 한다.
 *
 * <p>여기서는 «모양» 만 본다. 재료가 카탈로그의 어떤 종류인지, 섬장이 가졌는지는 카탈로그를 읽는 서비스가 본다.
 * 숫자가 빠진 것을 0 으로 받아들이지 않으려고 숫자 필드는 박싱 타입이다.
 *
 * @param body   한 줄 글 — 앞뒤 공백을 뗀 뒤 1~60자(코드 포인트), 줄바꿈·제어 문자 없음
 * @param layout 틀·스티커·테이프 배치
 */
public record PromotionContent(String body, Layout layout) {

    /** 홍보 글 상한 — 코드 포인트 수(정본 150행). {@code island_promotions.body varchar(60)} 과 같다. */
    public static final int MAX_BODY_LENGTH = 60;
    /** 스티커 상한(정본 133행). 테이프는 따로 0~1개다. */
    public static final int MAX_STICKERS = 10;

    /** 배치 형식 버전 — 지금은 1 하나. */
    private static final int LAYOUT_VERSION = 1;
    /** 칸 둘레에 걸칠 수 있는 폭 = 테이프가 붙는 테두리 띠의 폭. */
    private static final double EDGE = 0.08;
    private static final double MIN_SCALE = 0.06;
    private static final double MAX_SCALE = 0.6;
    private static final double MAX_ROTATION = 180;
    private static final int LINE_SEPARATOR = 0x2028;
    private static final int PARAGRAPH_SEPARATOR = 0x2029;

    /**
     * @param v        형식 버전(1)
     * @param frameId  칸 틀 재료 id(필수)
     * @param stickers 스티커 0~10개 — 같은 스티커 여러 장 허용. 뒤쪽이 위에 그려진다
     * @param tape     마스킹테이프 0~1개(없으면 null)
     */
    public record Layout(Integer v, String frameId, List<Sticker> stickers, Tape tape) {
    }

    public record Sticker(String assetId, Double x, Double y, Double scale, Double rotation) {
    }

    public record Tape(String assetId, Double x, Double y, Double rotation) {
    }

    /**
     * 모양 규칙을 확인하고 정규형을 돌려준다 — 글은 앞뒤 공백을 떼고, 빠진 스티커 목록은 빈 목록으로 채운다.
     *
     * @throws MagazineException 60자 초과는 422 {@code PROMOTION_TEXT_TOO_LONG}, 그 밖의 위반은 400
     *                           {@code PROMOTION_LAYOUT_INVALID}
     */
    public PromotionContent validated() {
        String text = body == null ? "" : body.strip();
        if (text.isEmpty() || text.codePoints().anyMatch(PromotionContent::breaksTheLine)) {
            throw invalid();
        }
        if (text.codePointCount(0, text.length()) > MAX_BODY_LENGTH) {
            throw new MagazineException(MagazineErrorCode.PROMOTION_TEXT_TOO_LONG);
        }
        if (layout == null || layout.v() == null || layout.v() != LAYOUT_VERSION || isBlank(layout.frameId())) {
            throw invalid();
        }
        List<Sticker> stickers = layout.stickers() == null ? List.of() : layout.stickers();
        if (stickers.size() > MAX_STICKERS) {
            throw invalid();
        }
        for (Sticker sticker : stickers) {
            if (sticker == null || isBlank(sticker.assetId()) || !inCell(sticker.x()) || !inCell(sticker.y())
                    || !within(sticker.scale(), MIN_SCALE, MAX_SCALE) || !isRotation(sticker.rotation())) {
                throw invalid();
            }
        }
        Tape tape = layout.tape();
        if (tape != null && (isBlank(tape.assetId()) || !inCell(tape.x()) || !inCell(tape.y())
                || !isRotation(tape.rotation()) || !onBorder(tape.x(), tape.y()))) {
            throw invalid();
        }
        return new PromotionContent(text, new Layout(LAYOUT_VERSION, layout.frameId(), List.copyOf(stickers), tape));
    }

    /** 이 배치가 쓰는 재료 id → 장수(틀·스티커·테이프 모두). 검증을 마친 배치에만 부른다. */
    public static Map<String, Integer> assetCounts(Layout layout) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        counts.merge(layout.frameId(), 1, Integer::sum);
        for (Sticker sticker : layout.stickers()) {
            counts.merge(sticker.assetId(), 1, Integer::sum);
        }
        if (layout.tape() != null) {
            counts.merge(layout.tape().assetId(), 1, Integer::sum);
        }
        return counts;
    }

    /** 한 줄 글을 깨는 문자 — 줄바꿈·탭 같은 제어 문자와 유니코드 줄·문단 구분자. */
    private static boolean breaksTheLine(int codePoint) {
        return Character.isISOControl(codePoint) || codePoint == LINE_SEPARATOR || codePoint == PARAGRAPH_SEPARATOR;
    }

    private static boolean inCell(Double value) {
        return within(value, -EDGE, 1 + EDGE);
    }

    private static boolean isRotation(Double value) {
        return within(value, -MAX_ROTATION, MAX_ROTATION);
    }

    /** NaN·null 은 거짓이다 — 비교를 «범위 안이면 참» 으로 써서 NaN 이 통과하지 못하게 한다. */
    private static boolean within(Double value, double min, double max) {
        return value != null && value >= min && value <= max;
    }

    /** 칸 안(둘레 포함)의 점이 테두리 띠 위인가 — 네 가장자리 중 하나에서 8% 안쪽까지. */
    private static boolean onBorder(double x, double y) {
        return x <= EDGE || x >= 1 - EDGE || y <= EDGE || y >= 1 - EDGE;
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private static MagazineException invalid() {
        return new MagazineException(MagazineErrorCode.PROMOTION_LAYOUT_INVALID);
    }
}
