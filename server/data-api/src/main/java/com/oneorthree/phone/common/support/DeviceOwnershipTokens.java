package com.oneorthree.phone.common.support;

/**
 * 기기 소유권 값({@code ownershipToken})의 <b>형식 관문</b> (A22 ㊚ · ㊟ · ㊲).
 *
 * <h2>왜 Data 가 검사하는가 — 여기가 «내구» 경계다</h2>
 * 이 값은 알림 서버가 {@code UUID} 로 발급해 앱에 돌려준 CAS 값이고, 저장되는 열도 {@code uuid} 다.
 * Data 는 그 값을 <b>outbox 봉투에 담아 영구 보관</b>한다(㊲). 형식이 깨진 값이 봉투에 실리면
 * 알림 서버 수신부가 그 봉투를 계속 실패시키고, relay 는 고갈 처리가 없어(A18) 순서 축이 같은
 * <b>그 유저의 뒤 이벤트가 전부</b> 막힌다 — 세션 폐기·탈퇴 tombstone 까지 함께 멈춘다.
 * 그러므로 검사는 <b>append 보다 앞</b>이어야 한다. 봉투에 들어간 뒤엔 고칠 방법이 없다.
 *
 * <h2>깨진 값을 {@code null} 로 접지 않는다</h2>
 * {@code null} 은 「CAS 검사 없음」이라는 <b>다른 뜻</b>이고, 그 뜻으로 접으면 낡은 삭제가 그 사이
 * 재등록된 지금 기기까지 지운다 — CAS 가 막으라고 있는 바로 그 일이다(㊚).
 *
 * <h2>{@code UUID.fromString} 을 쓰지 않는 이유</h2>
 * 그 파서는 {@code "1-1-1-1-1"} 같은 <b>축약형</b>도 받는다. 소유권 대조는 문자열 비교라, 정규
 * 표기로 다시 쓰면 달라지는 값을 통과시키면 같은 소유권이 둘로 갈린다.
 */
public final class DeviceOwnershipTokens {

    /** 정규 표기(8-4-4-4-12)만 받는다. {@code @Pattern} 에서도 쓰도록 문자열 상수로 둔다. */
    public static final String CANONICAL_UUID_PATTERN =
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

    private static final java.util.regex.Pattern CANONICAL_UUID =
            java.util.regex.Pattern.compile(CANONICAL_UUID_PATTERN);

    private DeviceOwnershipTokens() {
    }

    /**
     * 소유권 값이 정규 UUID 표기인가.
     *
     * @param ownershipToken 앱이 실어 보낸 값
     * @return {@code null}(= 없음)이거나 정규 표기면 {@code true}. 빈 문자열은 {@code false} 다 —
     *         「없음」과 같은 뜻으로 접으면 그것이 곧 CAS 를 잃은 넓은 삭제다
     */
    public static boolean isCanonicalOrAbsent(String ownershipToken) {
        return ownershipToken == null || CANONICAL_UUID.matcher(ownershipToken).matches();
    }
}
