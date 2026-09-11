package com.oneorthree.business.common.validation;

import com.oneorthree.business.common.exception.CommonErrorCode;
import com.oneorthree.business.common.exception.DomainException;

/**
 * 기기 소유권 값({@code ownershipToken} · {@code X-Device-Ownership})의 <b>형식 관문</b> (A22 ㊚ · ㊟).
 *
 * <h2>왜 여기서 막아야 하는가</h2>
 * 이 값은 알림 서버가 {@code UUID} 로 발급해 앱에 돌려준 CAS 값이고, 저장되는 열도 {@code uuid} 다.
 * 그런데 삭제 경로는 <b>Data outbox 에 먼저 내구 기록</b>하고(㊲) relay 가 그 봉투를 알림 서버로
 * 보낸다 — 형식이 깨진 값이 봉투에 실리면 수신부가 그 봉투를 계속 실패시키고, relay 는 고갈 처리가
 * 없어(A18) 순서 축(=유저)의 <b>뒤 이벤트를 전부</b> 막는다. 세션 폐기·탈퇴 tombstone 까지 함께
 * 멈추므로, 검사는 반드시 <b>내구 기록·상류 호출보다 앞</b>이어야 한다.
 *
 * <h2>깨진 값을 {@code null} 로 접지 않는다</h2>
 * {@code null} 은 「CAS 검사 없음」이라는 <b>다른 뜻</b>이다. 깨진 값을 그리로 접으면 낡은 삭제가
 * 그 사이 재등록된 지금 기기까지 지운다 — CAS 가 막으라고 있는 바로 그 일이다(㊚). 뜻대로 하면
 * 「어느 행에도 맞지 않는 소유권」이므로, 동기 경로에서는 <b>400 으로 거절</b>해 앱이 값을 고쳐
 * 다시 보내게 한다.
 *
 * <h2>{@code UUID.fromString} 을 쓰지 않는 이유</h2>
 * 그 파서는 {@code "1-1-1-1-1"} 같은 <b>축약형</b>도 받는다. 소유권 비교는 문자열 대조라, 정규
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
     * 소유권 값이 정규 UUID 표기인지 확인한다.
     *
     * @param ownershipToken 앱이 실어 보낸 값. {@code null} 은 「없음」이라 그대로 통과한다 —
     *                       롤아웃 기간의 구 앱은 이 값을 아예 보내지 못한다(㊟)
     * @throws DomainException 값이 있는데 정규 표기가 아니면 {@code INVALID_PARAMETER}(400).
     *                         빈 문자열도 여기에 걸린다 — 「없음」과 같은 뜻으로 접으면 그것이 곧
     *                         CAS 를 잃은 넓은 삭제다
     */
    public static void requireCanonical(String ownershipToken) {
        if (ownershipToken != null && !CANONICAL_UUID.matcher(ownershipToken).matches()) {
            throw new DomainException(CommonErrorCode.INVALID_PARAMETER);
        }
    }
}
