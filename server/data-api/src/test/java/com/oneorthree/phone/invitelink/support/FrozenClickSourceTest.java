package com.oneorthree.phone.invitelink.support;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 정지 원본의 조립·체크섬이 <b>링크 서버와 글자 단위로 같은지</b> 고정한다 (서비스 §7.2 · A22 ㋮).
 *
 * <p>이 테스트가 없으면 어긋남이 <b>이관 당일</b>에야 드러난다 — 그때는 전량
 * {@code SOURCE_CHECKSUM_MISMATCH} 로 막히고, 되돌릴 수 있는 단계가 이미 지나 있다.
 *
 * <p>기대값은 링크 쪽 {@code canonical()}·{@code checksum()} 을 <b>실제로 실행해</b> 얻은 값이다
 * (Node: {@code createHash('sha256').update(canonical(src)).digest('hex')}). 손으로 적은 상수가
 * 아니라는 점이 이 테스트의 전부다.
 */
class FrozenClickSourceTest {

    /** 링크 쪽 구현을 실행해 얻은 기대 체크섬. 아래 fixture 와 한 쌍이다. */
    private static final String EXPECTED_CHECKSUM =
            "2c6378637296da9f9087b7270b7ceafb1dda7662ad75b88b4e097a16e913ad30";

    private static Map<String, Object> fixture() {
        Map<String, Object> source = new LinkedHashMap<>();
        source.put("clickId", "11111111-1111-1111-1111-111111111111");
        source.put("linkId", "22222222-2222-2222-2222-222222222222");
        source.put("slug", "abc123");
        source.put("groupId", "33333333-3333-3333-3333-333333333333");
        source.put("inviterId", "44444444-4444-4444-4444-444444444444");
        source.put("linkVersion", "1");
        source.put("membershipEpoch", "1");
        source.put("transitionSeq", "0");
        source.put("groupName", "우리 그룹");
        source.put("inviterName", null);
        source.put("groupNameVersion", "7");
        source.put("inviterNameVersion", "7");
        source.put("groupClosed", false);
        source.put("linkStatus", "ACTIVE");
        source.put("linkCreatedAt", "2026-09-01T00:00:00.000Z");
        source.put("revokedAt", null);
        source.put("ipHash", "a".repeat(64));
        source.put("os", "ios");
        source.put("userAgent", null);
        source.put("clickedAt", "2026-09-02T03:04:05.123Z");
        source.put("matched", false);
        source.put("matchedAt", null);
        source.put("matchedDeviceId", null);
        source.put("appInstanceId", null);
        source.put("claimedUserId", null);
        source.put("claimedAt", null);
        return source;
    }

    @Test
    @DisplayName("체크섬이 링크 서버 구현과 같다 — 이 값이 어긋나면 이관 당일 전량 거절이다")
    void checksumMatchesLinkImplementation() {
        assertThat(FrozenClickSource.checksum(FrozenClickSource.canonicalize(fixture())))
                .isEqualTo(EXPECTED_CHECKSUM);
    }

    @Test
    @DisplayName("키 순서는 localeCompare 정렬이다 — clickedAt 이 clickId 보다 «앞선다»")
    void canonicalKeyOrderFollowsLocaleCompareNotCodePoint() {
        String json = FrozenClickSource.canonicalJson(FrozenClickSource.canonicalize(fixture()));

        // 코드포인트 정렬이면 'I'(0x49) < 'e'(0x65) 라 clickId 가 앞선다. 링크 쪽 localeCompare 는
        // 기저 문자 e < i 로 봐서 clickedAt 이 앞선다 — 이 한 쌍이 두 정렬을 가른다.
        assertThat(json.indexOf("\"clickedAt\"")).isLessThan(json.indexOf("\"clickId\""));
    }

    @Test
    @DisplayName("입력 순서가 달라도 같은 체크섬 — 조립이 정본 순서로 다시 세운다")
    void orderOfInputDoesNotChangeChecksum() {
        Map<String, Object> shuffled = new LinkedHashMap<>();
        fixture().entrySet().stream()
                .sorted((a, b) -> b.getKey().compareTo(a.getKey()))
                .forEach(entry -> shuffled.put(entry.getKey(), entry.getValue()));

        assertThat(FrozenClickSource.checksum(FrozenClickSource.canonicalize(shuffled)))
                .isEqualTo(EXPECTED_CHECKSUM);
    }

    @Test
    @DisplayName("시각은 밀리초 3자리로 깎는다 — 마이크로초를 남기면 받는 쪽 new Date() 와 어긋난다")
    void timestampIsTruncatedToMillis() {
        assertThat(FrozenClickSource.timestamp(Instant.parse("2026-09-02T03:04:05.123456789Z")))
                .isEqualTo("2026-09-02T03:04:05.123Z");
        assertThat(FrozenClickSource.timestamp(Instant.parse("2026-09-02T03:04:05Z")))
                .isEqualTo("2026-09-02T03:04:05.000Z");
        assertThat(FrozenClickSource.timestamp(null)).isNull();
    }

    @Test
    @DisplayName("필드가 빠지거나 남으면 조립에서 실패한다 — 이관 당일이 아니라 스냅샷 시점에 드러낸다")
    void contractMismatchFailsAtAssembly() {
        Map<String, Object> missing = new LinkedHashMap<>(fixture());
        missing.remove("slug");
        assertThatThrownBy(() -> FrozenClickSource.canonicalize(missing))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("slug");

        Map<String, Object> extra = new LinkedHashMap<>(fixture());
        extra.put("somethingNew", "x");
        assertThatThrownBy(() -> FrozenClickSource.canonicalize(extra))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("링크 원장 15필드도 링크 서버 구현과 같은 체크섬을 낸다")
    void linkChecksumMatchesLinkImplementation() {
        Map<String, Object> link = new LinkedHashMap<>();
        link.put("linkId", "22222222-2222-2222-2222-222222222222");
        link.put("slug", "abc123");
        link.put("groupId", "33333333-3333-3333-3333-333333333333");
        link.put("inviterId", "44444444-4444-4444-4444-444444444444");
        link.put("linkVersion", "1");
        link.put("membershipEpoch", "1");
        link.put("transitionSeq", "0");
        link.put("groupName", "우리 그룹");
        link.put("inviterName", null);
        link.put("groupNameVersion", "7");
        link.put("inviterNameVersion", "7");
        link.put("groupClosed", false);
        link.put("linkStatus", "ACTIVE");
        link.put("linkCreatedAt", "2026-09-01T00:00:00.000Z");
        link.put("revokedAt", null);

        assertThat(FrozenClickSource.checksum(FrozenClickSource.canonicalizeLink(link)))
                .isEqualTo("2084ab25b6d0f68b0a382cad93dcecd55e787a69ddf797a5b38f9624cf254a92");
    }

    @Test
    @DisplayName("manifest 체크섬은 «받은 순서 그대로» 계산한다 — DB 의 uuid 정렬이 곧 계약이다")
    void manifestChecksumMatchesLinkImplementation() {
        List<FrozenClickSource.ManifestPair> pairs = List.of(
                new FrozenClickSource.ManifestPair("11111111-1111-1111-1111-111111111111", "aa"),
                new FrozenClickSource.ManifestPair("22222222-2222-2222-2222-222222222222", "bb"));

        assertThat(FrozenClickSource.manifestChecksum("clickId", pairs))
                .isEqualTo("ecbbffe4fda5eb48e38945d1bbb527846d206ca8e1aadfa0241d2826293eadb7");
        // 빈 스냅샷도 값이 있어야 한다 — 「아직 안 뜬 회차」와 「0건인 회차」를 구분해야 검증이 닫힌다.
        assertThat(FrozenClickSource.manifestChecksum("linkId", List.of()))
                .isEqualTo("4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945");
    }

    @Test
    @DisplayName("숫자는 받지 않는다 — JS 숫자 표기와 어긋날 수 있어 세대 셋을 문자열로 싣는다")
    void numbersAreRejected() {
        Map<String, Object> withNumber = new LinkedHashMap<>(fixture());
        withNumber.put("linkVersion", 1L);
        assertThatThrownBy(() -> FrozenClickSource.checksum(FrozenClickSource.canonicalize(withNumber)))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
