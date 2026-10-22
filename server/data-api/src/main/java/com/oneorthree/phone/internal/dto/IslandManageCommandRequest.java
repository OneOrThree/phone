package com.oneorthree.phone.internal.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.oneorthree.phone.group.support.IslandInputPolicy;
import com.oneorthree.phone.group.repository.domain.Group;

import java.util.Map;
import java.util.Set;

/**
 * {@code PATCH /internal/islands/{islandId}} 본문 (GROMO-1802, 섬 관리 LLD §2·§3.1).
 *
 * <p>네 필드 모두 선택이고 <b>키가 없으면 미변경, 명시한 null 은 거절</b>이다 — 그래서 필드를 바로 받지 않고
 * 원본 맵에서 키 존재와 값을 따로 본다. 소개를 비우려면 빈 문자열을 보낸다. 계약 밖 키(password·isPrivate
 * 등)는 옛 잠금을 이 경로로 바꾸지 못하게 거절한다.
 *
 * <p><b>{@code maxMembers} 는 GROMO-1993 에서 열었다</b> — 정책 「정원은 마을회관에서 방장이 수정할 수
 * 있다. 현재 주민 수보다 작게 줄일 수는 없다」. 범위(1~15)는 여기서, <b>현원 하한은 서비스</b>가 본다:
 * 현원은 본문이 아니라 DB 상태라 잠금 아래에서만 정확하다.
 *
 * <p>이름 안전 문자 규칙은 {@link IslandInputPolicy#NAME_PATTERN} 하나가 정의다 — 섬 생성
 * ({@link CreateIslandCommandRequest})과 같은 경계를 쓴다. 여기서의 거절은 전부 400 {@code INVALID_REQUEST} 다.
 * <b>빈 이름만은 여기서 거르지 않는다</b> — LLD §2 가 422 로 정했는데 본문 파서 안의 예외는 읽기 실패 400 으로
 * 접힌다. 빈 이름은 서비스가 {@code ISLAND_NAME_BLANK}(422)로 거절한다.
 *
 * <p><b>인사말(GROMO-2262)</b> — 서비스가 앞뒤 공백을 잘라 저장하므로 길이(코드포인트 40자)와 한 줄 규칙을 모두
 * «자른 뒤» 값에 건다({@link GuestbookWriteRequest} 와 같다). 한 줄 규칙은 섬 이름과 같은
 * {@link IslandInputPolicy#NAME_PATTERN} 하나다(복사하지 않는다): 중간의 줄바꿈·탭 같은 제어문자와 양방향
 * 제어문자는 거절하고, 앞뒤 개행·탭은 공백처럼 잘려 통과한다. 빈 값·공백뿐인 값은 기본 문구로 되돌리는 값이라
 * 검사하지 않는다.
 *
 * @param name             새 이름 — null 이면 미변경
 * @param intro            새 소개 — null 이면 미변경
 * @param approvalRequired 새 가입 방식 — null 이면 미변경
 * @param maxMembers       새 정원(1~15) — null 이면 미변경
 * @param greeting         새 인사말(GROMO-2262, 앞뒤 공백을 자른 코드포인트 40자 이하의 한 줄) — null 이면
 *                         미변경, 빈 문자열·공백뿐이면 기본 문구로 되돌린다(서비스가 null 로 저장)
 */
public record IslandManageCommandRequest(String name, String intro, Boolean approvalRequired,
                                         Integer maxMembers, String greeting) {

    private static final Set<String> KEYS =
            Set.of("name", "intro", "approvalRequired", "maxMembers", "greeting");
    private static final int GREETING_MAX = 40;
    private static final int NAME_MAX = 50;
    private static final int INTRO_MAX = 200;

    /** 인사말 없는 호출(GROMO-2262 이전 시그니처) — 미변경이다. */
    public IslandManageCommandRequest(String name, String intro, Boolean approvalRequired, Integer maxMembers) {
        this(name, intro, approvalRequired, maxMembers, null);
    }

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static IslandManageCommandRequest fromJson(Map<String, Object> fields) {
        if (fields == null || !KEYS.containsAll(fields.keySet())) {
            throw new IllegalArgumentException("섬 정보 수정 요청의 필드가 올바르지 않습니다.");
        }
        String name = text(fields, "name");
        if (name != null && !name.isBlank() && (name.length() > NAME_MAX
                || !name.matches(IslandInputPolicy.NAME_PATTERN))) {
            throw new IllegalArgumentException("섬 이름이 올바르지 않습니다.");
        }
        String intro = text(fields, "intro");
        if (intro != null && intro.length() > INTRO_MAX) {
            throw new IllegalArgumentException("섬 소개가 너무 깁니다.");
        }
        String greeting = text(fields, "greeting");
        if (greeting != null) {
            // 길이와 한 줄 규칙을 «자른 뒤» 값에 건다(방명록 본문과 같다) — 앞뒤 개행·탭은 잘려 통과하고, 공백뿐이면
            // 비어서 검사하지 않는다(기본 문구로 복귀). 공백이 아닌 제어문자(널·DEL·C1·양방향)는 앞뒤에 붙어도 남아 거절된다.
            String stripped = greeting.strip();
            if (!stripped.isEmpty()) {
                if (stripped.codePointCount(0, stripped.length()) > GREETING_MAX) {
                    throw new IllegalArgumentException("섬 인사말이 너무 깁니다.");
                }
                if (!stripped.matches(IslandInputPolicy.NAME_PATTERN)) {
                    throw new IllegalArgumentException("섬 인사말은 한 줄이어야 합니다.");
                }
            }
        }
        Boolean approvalRequired = null;
        if (fields.containsKey("approvalRequired")) {
            if (!(fields.get("approvalRequired") instanceof Boolean value)) {
                throw new IllegalArgumentException("가입 방식은 boolean 이어야 합니다.");
            }
            approvalRequired = value;
        }
        Integer maxMembers = null;
        if (fields.containsKey("maxMembers")) {
            if (!(fields.get("maxMembers") instanceof Integer value)
                    || value < Group.MAX_MEMBERS_FLOOR || value > Group.MAX_MEMBERS_CEILING) {
                throw new IllegalArgumentException("섬 정원은 1~15 사이의 정수여야 합니다.");
            }
            maxMembers = value;
        }
        return new IslandManageCommandRequest(name, intro, approvalRequired, maxMembers, greeting);
    }

    private static String text(Map<String, Object> fields, String key) {
        if (!fields.containsKey(key)) {
            return null;
        }
        if (!(fields.get(key) instanceof String value)) {
            throw new IllegalArgumentException(key + " 는 문자열이어야 합니다.");
        }
        return value;
    }
}
