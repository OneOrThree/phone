package com.oneorthree.phone.invitelink.support;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Set;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * slug 는 사람이 카톡으로 받아 눈으로 보는 문자열이다 — 길이와 알파벳이 규격이고,
 * 규격이 흔들리면 이미 배포된 링크와 새 링크가 서로 다른 모양이 된다.
 */
class SlugGeneratorTest {

    private final SlugGenerator slugGenerator = new SlugGenerator();

    @Test
    @DisplayName("slug 는 8자이고 허용 알파벳만 쓴다")
    void generatesEightCharsFromAllowedAlphabet() {
        String slug = slugGenerator.generate();

        assertThat(slug).hasSize(8).matches("[23456789abcdefghjkmnpqrstuvwxyz]+");
    }

    @Test
    @DisplayName("혼동 문자(0·1·o·l·i)는 절대 나오지 않는다")
    void neverEmitsConfusableCharacters() {
        String joined = IntStream.range(0, 500)
                .mapToObj(i -> slugGenerator.generate())
                .reduce("", String::concat);

        assertThat(joined).doesNotContain("0", "1", "o", "l", "i");
    }

    @Test
    @DisplayName("연속 생성이 서로 다르다 — 충돌 재시도에 기대기 전에 난수 자체가 흩어져야 한다")
    void generatesDistinctValues() {
        Set<String> slugs = new HashSet<>();
        IntStream.range(0, 200).forEach(i -> slugs.add(slugGenerator.generate()));

        assertThat(slugs).hasSize(200);
    }
}
