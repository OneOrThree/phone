package com.oneorthree.business.usecase;

import com.oneorthree.business.common.exception.UpstreamDomainException;

import java.util.Map;
import java.util.Set;

/**
 * 「이 claim 의도를 닫아도 되는가」를 <b>한 자리에서</b> 판정한다.
 *
 * <h2>왜 공유 판정이 필요한가</h2>
 * 요청 경로({@link InviteLinkUseCase#claim})와 재개 경로({@link ClaimIntentReplayService})가 같은 상류
 * 판정을 <b>다르게</b> 다루면 두 방향으로 깨진다.
 * <ul>
 *   <li>요청 경로만 남기면 — 죽은 slug 를 든 앱이 로그인마다 새 의도를 적재한다(앱은 claim 용
 *       {@code Idempotency-Key} 를 보내지 않아 호출마다 새 base 가 생긴다). 그 행을 닫는 손이
 *       아무 데도 없어 「미완료 0」 gate 가 로그인 횟수만큼 올라간다.</li>
 *   <li>재개 경로가 <b>모든</b> 판정을 종결로 접으면 — 경로 허용목록 오배선처럼 코드가 실린
 *       403 까지 「완료」로 표시돼, 실제로는 아무것도 claim 되지 않았는데 gate 가 통과한다.</li>
 * </ul>
 *
 * <h2>판정 근거 (상류 소스 대조)</h2>
 * 종결 대상은 <b>아무리 다시 물어도 같은 답</b>이 나오는 것뿐이다.
 *
 * <table>
 *   <caption>종결 코드와 근거</caption>
 *   <tr><th>코드</th><th>상태</th><th>근거</th></tr>
 *   <tr><td>{@code SLUG_NOT_FOUND}</td><td>404</td>
 *       <td>{@code link/src/lib/links.ts:147} — {@code links} 행 자체가 없다. 링크는 재생성되지
 *           않으므로 재시도는 같은 부재를 다시 읽는다. Data 쪽 같은 이름의 코드도 같은 뜻이다
 *           ({@code InviteLinkErrorCode.SLUG_NOT_FOUND}).</td></tr>
 *   <tr><td>{@code USER_WITHDRAWN}</td><td>410</td>
 *       <td>{@code link/src/lib/ledger.ts:24} — 탈퇴는 익명화를 동반해 되돌릴 수 없다.</td></tr>
 * </table>
 *
 * <h2>일부러 뺀 것 — 「같은 답이 나온다」가 보장되지 않는다</h2>
 * <ul>
 *   <li><b>{@code IMPORT_IN_PROGRESS}</b>(503 · {@code link/src/lib/migration.ts:11}) ·
 *       {@code LINK_UNAVAILABLE}(503 · {@code errors.ts}) — 애초에 여기 오지 않는다. 5xx 는
 *       {@code InternalHttpClient.classify} 가 {@code UpstreamUnavailableException} 으로 접는다.
 *       이관이 끝나면 답이 달라지므로 종결 대상이 아니다.</li>
 *   <li><b>{@code CLAIM_CAPABILITY_INVALID}</b>(409) — 「만료된 자격」과 「셀프 초대」를 한 코드로 접은
 *       값이다. 앞은 재개가 링크에서 <b>새 자격</b>을 받아 다시 시도하면 성공할 수 있다
 *       ({@code links.ts} claim 끝의 capability 갱신). 섞인 코드를 종결로 접으면 살릴 수 있는 귀속을
 *       버린다.</li>
 *   <li><b>{@code CLAIM_REVOKED}</b>(409) — 대개 영구적이지만 판정 주체가 Data 의 멤버십 상태라
 *       링크 쪽 사실만으로 단정할 수 없다. 종결로 접으면 조용히 사라지고, 남겨 두면 재개 CLI 가
 *       실패로 보고해 사람이 본다. <b>후자를 고른다.</b></li>
 *   <li><b>{@code IDEMPOTENCY_KEY_CONFLICT}</b>(409 · {@code ledger.ts:38}) — 저장된 요청 해시와
 *       본문이 어긋났다는 뜻이고, 이 경로에서는 <b>우리 버그</b>다(요청은 매번 새 base 를 쓰고 재개는
 *       저장된 키를 복원한다). 종결로 접으면 그 버그가 「정상 종료」로 묻힌다.</li>
 * </ul>
 */
final class ClaimIntentTermination {

    /** 아무리 다시 물어도 같은 답이 나오는 판정. 위 표의 근거로만 늘린다. */
    private static final Set<String> TERMINAL_CODES = Set.of(
            "SLUG_NOT_FOUND",
            "USER_WITHDRAWN");

    /**
     * 종결 판정의 <b>원래 응답 상태</b>. 재생할 때 첫 요청과 같은 상태를 줘야 앱의 분기가 같다.
     *
     * <p>코드마다 적어 두는 이유: 재생 시점에는 상류를 다시 부르지 않으므로 상태를 어디선가
     * <b>기억</b>하고 있어야 한다. 원장에 코드만 남기고 상태를 여기서 되찾는 편이, 상태까지 원장에
     * 넣어 두 값이 서로 어긋날 여지를 만드는 것보다 낫다 — 이 표와 {@link #TERMINAL_CODES} 는 함께
     * 고친다.
     */
    private static final Map<String, Integer> TERMINAL_STATUSES = Map.of(
            "SLUG_NOT_FOUND", 404,
            "USER_WITHDRAWN", 410);

    /**
     * 코드가 실려 있어도 «판정»이 아닌 상태들.
     *
     * <p>408·429 는 「지금 말고 나중에」라 정의상 종결이 아니고, 401·403 은 <b>우리 서비스 토큰·경로
     * 허용목록의 문제</b>다({@code link/src/lib/auth.ts} 의 {@code INVALID_SERVICE_TOKEN} ·
     * {@code SERVICE_ROUTE_FORBIDDEN}, 라우트의 {@code USER_REQUIRED}). 고치고 다시 부르면 답이
     * 달라지므로 「사용자에 대한 판정」이 아니다.
     *
     * <p><b>403 이 실제로 여기 온다.</b> 링크 서버는 모든 실패 본문에 {@code code} 를 싣고
     * ({@code errors.ts respond}) {@code classify} 는 코드 유무를 401/403 검사보다 먼저 보므로,
     * 코드가 실린 403 은 {@code UpstreamCredentialRejectedException} 이 아니라 도메인 판정이 된다 —
     * 배선 사고를 판정으로 착각해 의도를 지우는 자리가 바로 여기다.
     *
     * <p>401 은 <b>대개</b> 여기 오지 않는다 — {@code SimpleClientHttpRequestFactory}(JDK
     * {@code HttpURLConnection})가 401 의 오류 본문을 흘려 버려 코드가 사라지고, 그래서 자격 거절
     * (502)로 분류된다. 전송 계층이 바뀌면 그 사실도 바뀌므로 401 도 목록에 남겨 둔다.
     */
    private static final Set<Integer> NEVER_TERMINAL_STATUSES = Set.of(401, 403, 408, 429);

    private ClaimIntentTermination() {
    }

    /**
     * 이 판정으로 대기 의도를 닫아도 되는가.
     *
     * @param e 상류가 코드를 실어 보낸 비-5xx 거절
     * @return {@code true} 면 재시도해도 결과가 같으므로 의도를 종결해도 된다
     */
    static boolean isTerminal(UpstreamDomainException e) {
        // 상류가 재시도 시각을 계산해 줬다면 그 자체가 「나중에 다시 오라」다. 코드 이름과 무관하게
        // 종결이 아니다 — 이 검사를 뒤에 두면 허용목록 코드에 retryAfterMs 가 붙는 날 조용히 깨진다.
        if (e.getRetryAfterMs() != null) {
            return false;
        }
        if (NEVER_TERMINAL_STATUSES.contains(e.getStatus())) {
            return false;
        }
        // ⚠️ code 를 먼저 null 검사한다 — Set.of 로 만든 집합은 contains(null) 에서 NPE 를 던진다.
        //    코드 없는 거절은 애초에 «판정»이 아니므로(InternalHttpClient.classify 가 계약 불일치로
        //    접는다) 종결 대상도 아니다.
        String code = e.getCode();
        return code != null && TERMINAL_CODES.contains(code);
    }

    /**
     * 원장에 남은 종결 코드로 <b>첫 요청이 받았던 판정</b>을 다시 만든다.
     *
     * <p>같은 {@code Idempotency-Key} 의 재시도는 상류를 다시 밟지 않는다 — 의도가 이미 종결됐기
     * 때문이다. 그때 200 을 주면 <b>첫 요청은 4xx 인데 재시도는 성공</b>이 되어 멱등 계약이 깨진다.
     * 응답이 유실돼 앱이 그대로 재시도한 경우가 정확히 이 모양이다.
     *
     * <p>{@code retryAfterMs} 는 싣지 않는다. 종결 판정은 정의상 「나중에 다시」가 아니고, 실으면
     * {@link #isTerminal} 이 그 값을 보고 종결이 아니라고 판정해 서로 어긋난다.
     *
     * @param code 원장에 남은 종결 코드
     * @return 첫 요청이 받았던 것과 같은 판정
     */
    static UpstreamDomainException replay(String code) {
        return new UpstreamDomainException(
                TERMINAL_STATUSES.getOrDefault(code, 409), code, null, null);
    }
}
