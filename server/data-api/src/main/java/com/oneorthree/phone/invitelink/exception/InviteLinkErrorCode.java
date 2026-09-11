package com.oneorthree.phone.invitelink.exception;

import com.oneorthree.phone.common.exception.ErrorCode;
import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * 초대 링크 도메인 에러 코드.
 *
 * <p>이름은 응답 본문의 {@code code} 로 그대로 나가 앱이 분기에 쓴다(스펙 §4-2 계약) — 변경 금지.
 */
@Getter
public enum InviteLinkErrorCode implements ErrorCode {

    GROUP_NOT_FOUND(HttpStatus.NOT_FOUND, "그룹을 찾을 수 없습니다."),
    NOT_MEMBER(HttpStatus.FORBIDDEN, "그룹원만 초대 링크를 만들 수 있습니다."),
    SLUG_NOT_FOUND(HttpStatus.NOT_FOUND, "초대 링크를 찾을 수 없습니다."),
    SLUG_GENERATION_FAILED(HttpStatus.INTERNAL_SERVER_ERROR, "초대 링크 생성에 실패했습니다."),

    /**
     * 링크가 서명한 가입 자격이 유효하지 않다 — 서명 불일치·형식 파손·만료 (A22 ⓚ).
     *
     * <p>세 가지를 한 코드로 접는 이유는 앱의 처리가 같기 때문이다(초대 없이 가입 흐름으로 되돌린다).
     * 어느 쪽이었는지를 응답으로 구분해 주면 자격 위조 시도에 힌트가 된다.
     */
    CLAIM_CAPABILITY_INVALID(HttpStatus.CONFLICT, "초대 자격이 만료됐거나 유효하지 않습니다."),

    /**
     * 폐기·탈퇴로 자격이 무효다 (A22 ㋙ · ⓑ).
     *
     * <p>{@code CLAIM_CAPABILITY_INVALID} 와 나눈 이유: 이쪽은 <b>서명은 정상인데 그 사이 멤버십이
     * 전이된</b> 경우다. 폐기는 그 사이 수락된 claim 까지 되돌린다 — relay 지연 중 링크는 active 로
     * 보여 claim 을 기록하는데, 그 귀속을 유효로 두면 유효하지 않은 초대가 가입 귀속·전환에 영구 집계된다.
     */
    CLAIM_REVOKED(HttpStatus.CONFLICT, "더 이상 유효하지 않은 초대입니다."),

    /** 재개 대상 claim 의도가 없다 — 이미 끝났거나 남의 것이다. 둘을 한 코드로 접는다(존재 노출 방지). */
    CLAIM_INTENT_NOT_FOUND(HttpStatus.NOT_FOUND, "처리할 초대 대기 항목이 없습니다."),

    /**
     * 리스를 잃은 실행자의 뒤늦은 완료 보고다.
     *
     * <p>200 으로 접으면 남이 진행 중인 재개가 「끝난 것」으로 덮여, 그 의도는 아무도 밟지 않은 채
     * 완료로 남는다.
     */
    CLAIM_INTENT_LEASE_STALE(HttpStatus.CONFLICT, "초대 대기 항목의 선점이 만료됐습니다."),

    /** 그 이관 회차가 없다 — 정지 스냅샷을 만들기 전이다(서비스 §7.2). */
    MIGRATION_NOT_FOUND(HttpStatus.NOT_FOUND, "이관 회차를 찾을 수 없습니다."),

    /**
     * {@code IMPORT_CLOSED} — 5단계로 넘어갔다(서비스 §7.2 · A22 ㋮).
     *
     * <p>늦은 백필·import 재시도를 거부한다. 여기서 허용하면 이미 소진된 Neon 상태를 구 스냅샷이 덮는다.
     */
    IMPORT_CLOSED(HttpStatus.CONFLICT, "이관 가져오기가 종료됐습니다.");

    private final HttpStatus status;
    private final String message;

    InviteLinkErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}
