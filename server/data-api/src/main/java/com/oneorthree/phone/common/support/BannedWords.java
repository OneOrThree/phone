package com.oneorthree.phone.common.support;

import com.oneorthree.phone.common.exception.BannedWordException;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 금칙어 <b>판정 단일점</b> (GROMO-1986) — 공지·댓글·편지·닉네임·섬 이름·섬 소개 여섯 입력이 같은 목록,
 * 같은 정규화, 같은 코드로 거절된다.
 *
 * <h2>왜 DTO 애노테이션이 아니라 서비스가 부르는가</h2>
 * ① 같은 컬럼에 쓰는 입구가 둘이다 — 2.0 내부 표면({@code IslandNoticeService}·{@code IslandMembershipService}
 * ·{@code IslandManagementService})과 레거시 {@code /api/v1}({@code GroupService}·{@code GroupAnnouncementService})
 * 이 같은 {@code groups}·{@code group_announcements} 행을 만든다. 한쪽 DTO 에만 붙이면 다른 입구가
 * 그대로 우회로가 된다. ② 그 입구 중 {@code InternalAccountController}(닉네임)·
 * {@code InternalIslandManagementController}(섬 수정) 는 {@code @Valid} 자체가 없어 애노테이션이 아예 안 돈다.
 * ③ 6종이 bean validation · {@code @JsonCreator} · 서비스 도메인 코드 세 갈래로 흩어져 있어, 규칙을
 * 저장 직전 한 층에 모으는 편이 갈라지지 않는다({@code UserService} 의 닉네임 길이 규칙과 같은 판단).
 *
 * <h2>왜 {@code common/support} 인가</h2>
 * 소비자가 {@code user}(L0) · {@code letter}(L2) · {@code group}(L5) · {@code internal}(L10) 에 걸쳐 있다.
 * {@code user} 가 바닥이라 어느 도메인 패키지에 두어도 {@code DomainLayerRulesTest} 의 «위에서 아래로만»
 * 규칙을 깬다. {@code common} 은 {@code LAYER_FREE} 라 누구나 참조할 수 있는 유일한 자리다. 새 최상위
 * 패키지({@code moderation} 등)를 만들면 「모든 도메인 패키지가 레이어 표에 있다」가 즉시 실패한다.
 *
 * <h2>목록은 리소스 파일이고, 기동 때 한 번 읽는다</h2>
 * 자바 상수로 박으면 목록을 고칠 때마다 코드 리뷰·재컴파일이 붙는다. 읽기는 {@code LandingRenderer} 의
 * 관례 그대로 <b>생성자에서 한 번</b>이다 — 파일이 없거나 비면 첫 요청이 아니라 <b>기동</b> 때 죽는다.
 * 필터가 조용히 꺼진 서버가 심사에 올라가는 것이 이 티켓이 막으려는 바로 그 사고다.
 *
 * <h2>판정은 «정규화 부분 일치 − 허용어 상쇄» 다</h2>
 * 문자·숫자가 아닌 것을 전부 지우고 소문자로 접은 뒤 세는 것이 1단계다 — "시 발" · "시*발" · "F U C K"
 * 같은 흔한 회피가 같은 문자열로 접힌다. 저장되는 값은 원문 그대로고, 정규화는 판정에만 쓴다.
 *
 * <p>그대로 두면 <b>Scunthorpe 문제</b>가 남는다: {@code 시발} 이 <b>시발점</b> 안에서, {@code rape} 가
 * <b>grape</b> 안에서 걸려 멀쩡한 글이 400 이 된다. 심사를 통과하려다 정상 사용자를 막는 쪽이 더 나쁘다.
 * 그래서 2단계로 <b>허용어(목록 파일의 {@code +} 줄)</b> 가 금칙어 적중을 <b>같은 수만큼 상쇄</b> 한다:
 * <ul>
 *   <li>적중 수는 <b>정규화본</b>에서 센다(회피를 잡으려면 구분자를 지운 쪽이어야 한다).</li>
 *   <li>상쇄 수는 <b>원문(대소문자만 접은 것)</b>에서 센다 — 허용어가 <b>붙여 쓴 한 덩어리</b>로 실제로
 *       있을 때만 면제다. 그래서 "시발점"은 통과하고 <b>"시발 점"은 막힌다</b>: 띄어쓰기로 허용어인
 *       척하는 회피가 열리지 않는다.</li>
 *   <li>적중이 상쇄보다 많으면 거절이다 — "시발점에서 시발" 은 적중 2 · 상쇄 1 이라 걸린다.</li>
 * </ul>
 * 한국어는 띄어쓰기가 없어 영어식 단어 경계가 통하지 않으므로, 두 언어를 <b>한 기계</b>로 다루고
 * 언어별 차이는 목록 파일의 데이터로만 표현한다(영어의 {@code grape}·{@code scunthorpe} 도 같은 {@code +} 줄이다).
 *
 * <p>ponytail: 목록 전체를 훑는 O(단어수 × 길이) 스캔이다. 목록이 수천 줄이 되거나 입력이 길어져
 * 측정 가능하게 느려지면 Aho-Corasick 으로 바꾼다 — 그 전엔 100줄짜리 목록에 자료구조를 들이지 않는다.
 * 남는 천장 둘: ① 자모 분해(ㅅㅣ발)·유니코드 유사문자(sһit)는 못 잡는다 ② 구분자를 지우므로 <b>낱말
 * 경계를 넘어 붙는</b> 오탐(예: "아가씨 발" → "아가씨발")이 원리상 남는다 — 알려지면 {@code +} 줄이
 * 아니라 그 조합을 허용어로 넣을 수 없으니(상쇄는 붙여 쓴 원문만 본다) 금칙어 쪽을 다시 봐야 한다.
 * 목록 기반 필터의 알려진 천장이고, 심사 요건(「걸러내는 수단이 있는가」)은 이 천장 아래에서 충족된다.
 */
@Component
public class BannedWords {

    /** 목록 파일 — classpath. 없거나 비면 기동이 실패한다. */
    static final String LIST_PATH = "moderation/banned-words.txt";

    /** 판정 전에 지우는 것 — 문자도 숫자도 아닌 모든 것(공백·구두점·이모지·별표). */
    private static final Pattern NOISE = Pattern.compile("[^\\p{IsAlphabetic}\\p{IsDigit}]+");

    private static final String COMMENT_PREFIX = "#";

    /** 허용어(예외) 줄의 표시 — 금칙어를 품은 정상어를 이 접두로 적는다. */
    private static final String ALLOW_PREFIX = "+";

    /** 정규화된 금칙어. 파일 순서를 유지해 어떤 줄이 걸렸는지 추적하기 쉽게 둔다. */
    private final Set<String> words;

    /** 정규화된 허용어 — 금칙어 적중을 같은 수만큼 상쇄한다(클래스 주석 2단계). */
    private final Set<String> allowed;

    public BannedWords() {
        Map<Boolean, Set<String>> loaded = load();
        this.words = loaded.get(Boolean.FALSE);
        this.allowed = loaded.get(Boolean.TRUE);
    }

    /**
     * 주어진 입력 중 하나라도 금칙어를 품고 있으면 거절한다. {@code null} 은 「보내지 않음」이라 건너뛴다 —
     * 부분 수정(PATCH)에서 생략된 필드를 빈 문자열로 접으면 안 보낸 필드가 검사에 걸린다.
     *
     * @param texts 사용자가 보낸 원문들 (제목·본문처럼 한 요청에 여럿이면 한 번에 넘긴다)
     * @throws BannedWordException {@code BANNED_WORD}(400)
     */
    public void requireClean(String... texts) {
        for (String text : texts) {
            if (contains(text)) {
                throw new BannedWordException();
            }
        }
    }

    /**
     * 판정만 한다 — 던지지 않는다.
     *
     * @param text 검사할 원문. {@code null} 이면 {@code false}
     * @return 금칙어를 품고 있으면 {@code true}
     */
    public boolean contains(String text) {
        if (text == null) {
            return false;
        }
        String normalized = normalize(text);
        if (normalized.isEmpty()) {
            return false;
        }
        String raw = text.toLowerCase(Locale.ROOT);
        for (String word : words) {
            int hits = occurrences(normalized, word);
            if (hits > 0 && hits > exemptions(raw, word)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 이 적중이 정상어에서 온 것으로 인정할 수 있는 횟수.
     *
     * <p>허용어를 <b>원문</b>에서 세는 것이 핵심이다 — 정규화본에서 세면 "시발 점" 이 "시발점" 으로 접혀
     * 스스로를 면제하는 회피가 열린다.
     */
    private int exemptions(String rawLowerCased, String word) {
        int total = 0;
        for (String safe : allowed) {
            if (safe.contains(word)) {
                total += occurrences(rawLowerCased, safe) * occurrences(safe, word);
            }
        }
        return total;
    }

    /** 겹치지 않는 등장 횟수. */
    private static int occurrences(String haystack, String needle) {
        int count = 0;
        for (int at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length())) {
            count++;
        }
        return count;
    }

    private static String normalize(String text) {
        return NOISE.matcher(text).replaceAll("").toLowerCase(Locale.ROOT);
    }

    /** {@code false} → 금칙어, {@code true} → 허용어. */
    private static Map<Boolean, Set<String>> load() {
        String raw;
        try {
            raw = new ClassPathResource(LIST_PATH).getContentAsString(StandardCharsets.UTF_8);
        } catch (IOException e) {
            // 목록이 없으면 필터가 통째로 무력해진다 — 첫 요청 때가 아니라 기동 때 드러낸다.
            throw new UncheckedIOException("금칙어 목록을 읽을 수 없습니다: " + LIST_PATH, e);
        }
        Set<String> banned = new LinkedHashSet<>();
        Set<String> safe = new LinkedHashSet<>();
        for (String line : raw.split("\\R")) {
            String trimmed = line.trim();
            if (trimmed.isEmpty() || trimmed.startsWith(COMMENT_PREFIX)) {
                continue;
            }
            boolean allow = trimmed.startsWith(ALLOW_PREFIX);
            String normalized = normalize(allow ? trimmed.substring(ALLOW_PREFIX.length()) : trimmed);
            if (normalized.isEmpty()) {
                continue;
            }
            (allow ? safe : banned).add(normalized);
        }
        if (banned.isEmpty()) {
            // 빈 목록 = 항상 통과. 「검사하고 있다」고 믿는 채로 아무것도 안 막는 상태가 가장 나쁘다.
            throw new IllegalStateException("금칙어 목록이 비어 있습니다: " + LIST_PATH);
        }
        for (String allowedWord : safe) {
            if (banned.contains(allowedWord)) {
                // 같은 낱말이 양쪽에 있으면 그 낱말은 영원히 통과한다 — 목록을 고치다 생기는 조용한 구멍이다.
                throw new IllegalStateException("금칙어와 허용어에 같은 낱말이 있습니다: " + allowedWord);
            }
            for (String other : safe) {
                if (!other.equals(allowedWord) && allowedWord.contains(other)) {
                    // grape + grapefruit 처럼 겹쳐 적으면 «한 번 쓴» 정상어가 상쇄를 두 번 벌어,
                    // "grapefruit rape" 가 통과하는 회피가 열린다. 짧은 쪽 하나만 적는다.
                    throw new IllegalStateException(
                            "허용어가 다른 허용어를 품고 있습니다(짧은 쪽만 남기세요): " + allowedWord + " ⊃ " + other);
                }
            }
        }
        return Map.of(Boolean.FALSE, banned, Boolean.TRUE, safe);
    }
}
