package com.oneorthree.business.usecase;

import com.oneorthree.business.common.exception.CommonErrorCode;
import com.oneorthree.business.common.exception.DomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.config.CompatProperties;
import com.oneorthree.business.upstream.data.DataApiClient;
import com.oneorthree.business.upstream.data.dto.FrozenClickCandidate;
import com.oneorthree.business.upstream.link.LinkApiClient;
import com.oneorthree.business.upstream.link.dto.LinkMatchCommand;
import com.oneorthree.business.upstream.link.dto.LinkMatchResult;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 이관 정지 창의 <b>한시</b> {@code /l/match} 조합 (A22 ㊫ · 서비스 §7.2 3~6단계).
 *
 * <h2>왜 Business 뿐인가</h2>
 * 링크는 코어를 못 부르고 Data → 링크는 relay 외 금지다. 구·신 양쪽 후보를 동시에 보아야 하는 주체는
 * <b>Business 하나</b>다. 그래서 정지 창 동안만 nginx 가 {@code /l/match} 를 여기로 보내고
 * <b>컷오버 후 제거</b>한다 — 그래서 기본값이 「꺼짐」이다.
 *
 * <h2>소진은 Neon 한 곳에서만</h2>
 * A22 ㊥: 매치는 읽기가 아니라 <b>소진(쓰기)</b>다. 정지 창에도 쓰기 원장은 Neon 하나이고 구 DB 는
 * <b>후보 조회만</b> 한다 — 양쪽에서 소진하면 잠금이 공유되지 않아 같은 클릭이 두 기기에 배정된다.
 *
 * <h2>import 계약 준비 전에는 구 후보를 넘기지 않는다 — {@code migrationId} 조차 싣지 않는다</h2>
 * §7.2 4단계는 구 후보를 Neon 에 반영할 때 <b>같은 트랜잭션에서</b> {@code (migrationId, clickId)} 의
 * {@code compat_applied} 표시 · 원본 체크섬 · 소진 결과 · 감사 레코드를 함께 커밋하도록 요구한다.
 * 그 표면이 링크 쪽에 준비되기 전에 구 행을 밀어 넣는 것은 <b>임의 이중 소진</b>이다. 그래서
 * {@code business.compat.import-contract-ready=false} 인 동안은 Neon 후보만 소진하고, 구 후보는
 * 조회해 <b>관측만</b> 한다(몇 건이 아직 구 쪽에만 있는지 세는 것이 4단계 진입 판단의 입력이다).
 *
 * <p>그때 <b>{@code migrationId} 를 요청에서 생략</b>해야 한다 — 링크 서버는 그 필드가 있으면 import
 * 모드로 들어가 {@code openRun} 을 요구하므로({@code link/src/lib/links.ts:104-113}),
 * {@code IMPORT_CLOSED} 이후엔 빈 배열을 보내도 503 이 된다.
 *
 * <h2>5초는 재시도까지 합친 전체 예산이다</h2>
 * {@code deferredInvite.ts:100} 의 {@code MATCH_TIMEOUT_MS=5000} 이고 실패하면 <b>다음 앱 실행까지
 * 재시도가 없다</b>. 예산을 넘긴 재시도는 앱이 이미 끊은 뒤에 성공하고 사용자에게는 되돌릴 수 없는
 * {@code matched:false} 만 남는다 — 그래서 {@link Deadline} 이 재시도를 가른다.
 *
 * <p><b>오류를 {@code matched:false} 로 접지 않는다</b>: 앱은 「응답을 받았다」만으로 확인 완료
 * 플래그를 세우므로, 판정 불가를 false 로 주면 그 설치의 초대가 영구히 사라진다. 상류 실패는 5xx 로
 * 올라간다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CompatMatchUseCase {

    private final CompatProperties compatProperties;
    private final DataApiClient dataApiClient;
    private final LinkApiClient linkApiClient;

    /**
     * @param ipHash {@code SHA-256(UTF8(ip + 기존 salt))} — <b>신뢰한 프록시의 원본 IP</b> 에서만 만든다.
     *               외부 위조 헤더를 그대로 쓰면 매치가 조작되고, salt 를 새로 만들면 매치가 전멸한다(ⓕ)
     */
    public LinkMatchResult match(String ipHash, String os, String deviceId, String appInstanceId,
            RequestIdempotencyKeys keys) {

        if (!compatProperties.isMatchHandlerEnabled()) {
            // 컷오버 후 제거가 계약이다. 남아 있으면 라우팅이 바뀐 뒤에도 구 경로가 살아 이중 소진 위험이
            // 생기므로, 켜져 있지 않은 동안은 이 경로가 «존재하지 않는 것»으로 보여야 한다.
            throw new DomainException(CommonErrorCode.COMPAT_HANDLER_DISABLED);
        }

        Deadline deadline = Deadline.startingNow(compatProperties.getMatchBudget());

        if (!compatProperties.isImportContractReady()) {
            // 준비 전: 구 후보를 «세기만» 한다. 이 수치가 4단계 진입 판단의 입력이다.
            // 관측용이라 조회 실패를 삼켜도 매치 결과가 달라지지 않는다.
            int pending = exportFrozen(ipHash, os, deadline, false).size();
            if (pending > 0) {
                log.info("구 DB 에만 있는 후보 {}건 — import 계약 준비 전이라 소진하지 않는다", pending);
            }
            // ⚠️ migrationId 를 «생략»한다. 링크 서버는 이 필드가 있으면 import 모드로 들어가
            //    openRun 을 요구하고(link/src/lib/links.ts:104-113) IMPORT_CLOSED 이후엔 503 을 준다 —
            //    빈 배열을 함께 보내도 마찬가지다. null 이어야 직접 매치 경로를 탄다.
            return linkApiClient.match(
                    new LinkMatchCommand(ipHash, os, deviceId, appInstanceId, null, null),
                    keys.forStep("compat-match"),
                    deadline);
        }

        // 4단계 진입 후: 구 정지 행 «전체»를 래퍼 그대로 넘겨 링크가 반영·소진하게 한다.
        // 원본 JSON 을 손대지 않는 것이 핵심이다 — sourceChecksum 이 source 객체 전체의 체크섬이라
        // 필드를 풀어 다시 조립하면 SOURCE_CHECKSUM_MISMATCH 가 난다(migration.ts:61).
        // 준비 후에는 이 후보가 «실제로 반영»된다. 조회 실패를 빈 목록으로 접으면 그 IP·OS 의 초대가
        // 구 DB 에만 있을 때 링크가 matched:false 를 돌려주고, 앱은 응답을 받았다는 이유로 완료 마커를
        // 세워 다시 시도하지 않는다 — 그 초대는 영구히 사라진다. 그래서 실패를 그대로 올린다.
        List<LinkMatchCommand.FrozenSource> frozen = exportFrozen(ipHash, os, deadline, true).stream()
                .map(row -> new LinkMatchCommand.FrozenSource(row.source(), row.sourceChecksum()))
                .toList();
        return linkApiClient.match(
                new LinkMatchCommand(ipHash, os, deviceId, appInstanceId,
                        compatProperties.getMigrationId(), frozen),
                keys.forStep("compat-match"),
                deadline);
    }

    /**
     * 구 후보 조회. <b>실패를 삼킬지는 단계가 정한다</b> — 같은 조회지만 4단계 전후로 그 실패가 뜻하는
     * 바가 정반대다.
     *
     * <h2>준비 전({@code required=false}): 삼킨다</h2>
     * 구 후보를 <b>세기만</b> 하고 소진은 Neon 이 한다. 그 수치는 4단계 진입 판단의 입력일 뿐이라
     * 조회가 실패해도 매치 자체는 Neon 후보만으로 성립한다. 여기서 전체 실패로 접으면 이관 도구의
     * 장애가 <b>정상 설치의 초대를 전멸시킨다</b>. 로그만 남긴다.
     *
     * <h2>준비 후({@code required=true}): 올린다</h2>
     * 이때의 빈 목록은 「구 쪽에 후보가 없다」는 <b>사실 주장</b>이고, 링크는 그 주장을 믿고
     * {@code matched:false} 나 다른 Neon 후보로 <b>소진을 확정</b>한다. 조회 실패를 빈 목록으로 접으면
     * 실제로는 정지 스냅샷에 더 맞는 구 클릭이 있는데도 그 확정이 나가고, 앱은 「응답을 받았다」로
     * 확인 완료를 기록해 <b>다음 실행에서 재시도하지 않는다</b> — 귀속이 영구히 사라진다.
     * 이 클래스 머리말의 「오류를 {@code matched:false} 로 접지 않는다」가 바로 이 자리를 말한다.
     *
     * <p>그래서 상류 예외를 그대로 올린다. {@code GlobalExceptionHandler} 가 그것을 5xx 로 내리므로
     * 앱은 확인 완료를 세우지 않고 다음 실행에서 다시 시도한다.
     *
     * @param required 이 조회의 결과가 소진 확정의 입력인가 — 그렇다면 실패를 삼키지 않는다
     */
    private List<FrozenClickCandidate> exportFrozen(String ipHash, String os, Deadline deadline,
            boolean required) {
        String migrationId = compatProperties.getMigrationId();
        if (migrationId == null || migrationId.isBlank()) {
            return List.of();
        }
        try {
            List<FrozenClickCandidate> rows = dataApiClient.exportFrozenCandidates(migrationId, ipHash, os,
                    deadline);
            return rows == null ? List.of() : rows;
        } catch (RuntimeException e) {
            if (required) {
                // 빈 목록으로 접으면 「구 쪽에 없다」는 거짓 주장이 되어 소진이 확정된다.
                log.warn("구 정지 스냅샷 후보 조회 실패 — import 계약이 열려 있어 매치를 확정하지 않는다", e);
                throw e;
            }
            log.warn("구 정지 스냅샷 후보 조회 실패 — 관측 단계라 Neon 후보만으로 진행한다", e);
            return List.of();
        }
    }
}
