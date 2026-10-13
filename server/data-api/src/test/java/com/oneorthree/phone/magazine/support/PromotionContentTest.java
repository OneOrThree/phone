package com.oneorthree.phone.magazine.support;

import com.oneorthree.phone.magazine.exception.MagazineErrorCode;
import com.oneorthree.phone.magazine.exception.MagazineException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 홍보 칸 내용의 모양 규칙 (GROMO-2289, 잡지 구현 계획 §2-3). 재료 종류·보유는 서비스 통합 테스트가 본다. */
class PromotionContentTest {

    private static final PromotionContent.Sticker CAT =
            new PromotionContent.Sticker("mag.cat-black-book", 0.82, 0.30, 0.22, -12.0);
    private static final PromotionContent.Tape TAPE = new PromotionContent.Tape("mag.tape-cream", 0.5, 0.0, -4.0);

    @Test
    @DisplayName("정규형 — 글의 앞뒤 공백을 떼고, 스티커 목록이 없으면 빈 목록이다")
    void normalizes() {
        PromotionContent valid = new PromotionContent("  같이 공부해요 ", new PromotionContent.Layout(1,
                "mag.frame-scallop", null, null)).validated();

        assertThat(valid.body()).isEqualTo("같이 공부해요");
        assertThat(valid.layout().stickers()).isEmpty();
        assertThat(valid.layout().tape()).isNull();
    }

    @Test
    @DisplayName("글은 1~60자(코드 포인트) — 이모지 60개는 통과, 61자는 422, 빈 글·공백뿐·줄바꿈·탭·줄 구분자는 400")
    void bodyRules() {
        String emoji60 = "🐟".repeat(60);
        assertThat(content(emoji60, layout(List.of())).validated().body()).as("UTF-16 으로는 120 이지만 60자다")
                .isEqualTo(emoji60);
        assertThat(content("가".repeat(60), layout(List.of())).validated().body()).hasSize(60);

        assertCode(content("가".repeat(61), layout(List.of())), MagazineErrorCode.PROMOTION_TEXT_TOO_LONG);
        assertCode(content("", layout(List.of())), MagazineErrorCode.PROMOTION_LAYOUT_INVALID);
        assertCode(content("   ", layout(List.of())), MagazineErrorCode.PROMOTION_LAYOUT_INVALID);
        assertCode(content(null, layout(List.of())), MagazineErrorCode.PROMOTION_LAYOUT_INVALID);
        assertCode(content("첫 줄\n둘째 줄", layout(List.of())), MagazineErrorCode.PROMOTION_LAYOUT_INVALID);
        assertCode(content("첫 줄\r둘째 줄", layout(List.of())), MagazineErrorCode.PROMOTION_LAYOUT_INVALID);
        assertCode(content("탭\t글", layout(List.of())), MagazineErrorCode.PROMOTION_LAYOUT_INVALID);
        // 앞뒤에 붙은 금지 문자도 거절한다 — strip 이 지워 버리기 전에 원문에서 본다.
        assertCode(content("홍보 문구\n", layout(List.of())), MagazineErrorCode.PROMOTION_LAYOUT_INVALID);
        assertCode(content("\t홍보 문구", layout(List.of())), MagazineErrorCode.PROMOTION_LAYOUT_INVALID);
        assertCode(content("홍보 문구" + (char) 0x2029, layout(List.of())), MagazineErrorCode.PROMOTION_LAYOUT_INVALID);
        assertCode(content("줄" + (char) 0x2028 + "구분", layout(List.of())), MagazineErrorCode.PROMOTION_LAYOUT_INVALID);
    }

    @Test
    @DisplayName("배치 — 버전 1·틀 필수, 스티커는 10개까지(같은 스티커 여러 장 허용), 11개는 400")
    void layoutRules() {
        assertThat(content("안녕", layout(Collections.nCopies(10, CAT))).validated().layout().stickers()).hasSize(10);

        assertCode(content("안녕", layout(Collections.nCopies(11, CAT))), MagazineErrorCode.PROMOTION_LAYOUT_INVALID);
        assertCode(content("안녕", null), MagazineErrorCode.PROMOTION_LAYOUT_INVALID);
        assertCode(content("안녕", new PromotionContent.Layout(2, "mag.frame-scallop", List.of(), null)),
                MagazineErrorCode.PROMOTION_LAYOUT_INVALID);
        assertCode(content("안녕", new PromotionContent.Layout(null, "mag.frame-scallop", List.of(), null)),
                MagazineErrorCode.PROMOTION_LAYOUT_INVALID);
        assertCode(content("안녕", new PromotionContent.Layout(1, " ", List.of(), null)),
                MagazineErrorCode.PROMOTION_LAYOUT_INVALID);
        List<PromotionContent.Sticker> withNull = new ArrayList<>();
        withNull.add(null);
        assertCode(content("안녕", layout(withNull)), MagazineErrorCode.PROMOTION_LAYOUT_INVALID);
    }

    @Test
    @DisplayName("스티커 범위 — 좌표 -0.08~1.08, 크기 0.06~0.6, 회전 -180~180 이고 경계값은 통과, 빠진 숫자·NaN 은 400")
    void stickerRanges() {
        for (PromotionContent.Sticker edge : List.of(sticker(-0.08, 1.08, 0.06, -180.0),
                sticker(1.08, -0.08, 0.6, 180.0))) {
            assertThat(content("안녕", layout(List.of(edge))).validated().layout().stickers()).hasSize(1);
        }
        for (PromotionContent.Sticker bad : List.of(sticker(-0.081, 0.5, 0.2, 0.0), sticker(0.5, 1.081, 0.2, 0.0),
                sticker(0.5, 0.5, 0.059, 0.0), sticker(0.5, 0.5, 0.61, 0.0), sticker(0.5, 0.5, 0.2, 180.1),
                sticker(null, 0.5, 0.2, 0.0), sticker(0.5, 0.5, null, 0.0), sticker(Double.NaN, 0.5, 0.2, 0.0),
                new PromotionContent.Sticker(null, 0.5, 0.5, 0.2, 0.0))) {
            assertCode(content("안녕", layout(List.of(bad))), MagazineErrorCode.PROMOTION_LAYOUT_INVALID);
        }
    }

    @Test
    @DisplayName("테이프는 0~1개이고 가운데 점이 테두리 띠(가장자리 8% 안쪽) 위여야 한다 — 칸 한가운데는 400")
    void tapeMustSitOnTheBorder() {
        for (PromotionContent.Tape edge : List.of(TAPE, tape(0.0, 0.5), tape(0.92, 0.5), tape(0.5, 1.08),
                tape(0.08, 0.5))) {
            assertThat(content("안녕", new PromotionContent.Layout(1, "mag.frame-scallop", List.of(), edge))
                    .validated().layout().tape()).isEqualTo(edge);
        }
        for (PromotionContent.Tape bad : List.of(tape(0.5, 0.5), tape(0.09, 0.91), tape(1.09, 0.0),
                new PromotionContent.Tape("mag.tape-cream", 0.5, 0.0, 181.0),
                new PromotionContent.Tape("", 0.5, 0.0, 0.0))) {
            assertCode(content("안녕", new PromotionContent.Layout(1, "mag.frame-scallop", List.of(), bad)),
                    MagazineErrorCode.PROMOTION_LAYOUT_INVALID);
        }
    }

    @Test
    @DisplayName("요청 본문 변환 — 본문·배치·스티커·테이프 어디든 모르는 키나 틀린 타입은 400, 정상 본문은 그대로 바뀐다")
    void fromRejectsUnknownKeysAndWrongTypes() {
        Map<String, Object> sticker = Map.of("assetId", "mag.fish", "x", 0.5, "y", 0.5, "scale", 0.2, "rotation", 0);
        Map<String, Object> layout = Map.of("v", 1, "frameId", "mag.frame-scallop", "stickers", List.of(sticker));

        PromotionContent parsed = PromotionContent.from(Map.of("body", "안녕", "layout", layout));
        assertThat(parsed.layout().stickers()).singleElement()
                .isEqualTo(new PromotionContent.Sticker("mag.fish", 0.5, 0.5, 0.2, 0.0));

        assertFromRejected(Map.of("body", "안녕", "layout", Map.of("v", 1, "frameId", "mag.frame-scallop",
                "sticker", List.of(sticker))));
        assertFromRejected(Map.of("body", "안녕", "layout", Map.of("v", 1, "frameId", "mag.frame-scallop",
                "stickers", List.of(Map.of("assetId", "mag.fish", "x", 0.5, "y", 0.5, "scale", 0.2, "rotation", 0,
                        "z", 3)))));
        assertFromRejected(Map.of("body", "안녕", "layout", Map.of("v", 1, "frameId", "mag.frame-scallop",
                "tape", Map.of("assetId", "mag.tape-cream", "x", 0.5, "y", 0.0, "rotation", 0, "color", "red"))));
        assertFromRejected(Map.of("body", "안녕", "layout", layout, "extra", true));
        assertFromRejected(Map.of("body", "안녕", "layout", Map.of("v", 1, "frameId", "mag.frame-scallop",
                "stickers", "mag.fish")));
        assertFromRejected(Map.of("body", List.of("안녕"), "layout", layout));
    }

    @Test
    @DisplayName("재료 장수 — 틀·스티커·테이프를 id 별로 센다")
    void assetCounts() {
        PromotionContent.Layout layout = new PromotionContent.Layout(1, "mag.frame-scallop",
                List.of(CAT, CAT, sticker(0.1, 0.1, 0.1, 0.0)), TAPE);

        assertThat(PromotionContent.assetCounts(layout)).containsExactly(
                Map.entry("mag.frame-scallop", 1), Map.entry("mag.cat-black-book", 2),
                Map.entry("mag.fish", 1), Map.entry("mag.tape-cream", 1));
    }

    private static PromotionContent content(String body, PromotionContent.Layout layout) {
        return new PromotionContent(body, layout);
    }

    private static PromotionContent.Layout layout(List<PromotionContent.Sticker> stickers) {
        return new PromotionContent.Layout(1, "mag.frame-scallop", stickers, null);
    }

    private static PromotionContent.Sticker sticker(Double x, Double y, Double scale, Double rotation) {
        return new PromotionContent.Sticker("mag.fish", x, y, scale, rotation);
    }

    private static PromotionContent.Tape tape(double x, double y) {
        return new PromotionContent.Tape("mag.tape-pink", x, y, 0.0);
    }

    private static void assertFromRejected(Map<String, Object> requestBody) {
        assertThatThrownBy(() -> PromotionContent.from(requestBody)).isInstanceOfSatisfying(MagazineException.class,
                e -> assertThat(e.getErrorCode()).isEqualTo(MagazineErrorCode.PROMOTION_LAYOUT_INVALID));
    }

    private static void assertCode(PromotionContent content, MagazineErrorCode code) {
        assertThatThrownBy(content::validated).isInstanceOfSatisfying(MagazineException.class,
                e -> assertThat(e.getErrorCode()).isEqualTo(code));
    }
}
