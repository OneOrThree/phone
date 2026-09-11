package com.oneorthree.business.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * 이관 정지 창 전용 설정 — {@code business.compat.*}.
 *
 * <p><b>기본값은 「꺼짐」이다.</b> 한시 호환 핸들러(`/l/match`)는 정지 창 동안만 존재해야 하고
 * 컷오버 후 제거한다(A22 ㊫). 켜진 채로 배포되면 라우팅이 바뀐 뒤에도 구 경로가 남아 이중 소진
 * 위험이 생긴다.
 *
 * <p>{@code importContractReady} 는 <b>구 DB 후보를 Neon 으로 이관하는 계약이 실제로 준비됐는가</b>다.
 * §7.2 4단계의 기록·병합·검증 규칙(`compat_applied` 표시 · 원본 체크섬 · 감사 레코드)을 링크 서버가
 * 제공하기 전에는 <b>구 DB 후보를 소진하지 않는다</b> — 양쪽에서 소진하면 잠금이 공유되지 않아 같은
 * 클릭이 두 기기에 배정된다(A22 ㊥).
 */
@Getter
@Setter
@ConfigurationProperties(prefix = "business.compat")
public class CompatProperties {

    /** 한시 `/l/match` 핸들러를 노출하는가. 기본 false. */
    private boolean matchHandlerEnabled;

    /**
     * 구 정지 스냅샷 → Neon 이관(import) 계약이 준비됐는가. 기본 false.
     *
     * <p>false 이면 호환 핸들러는 <b>Neon 후보만</b> 조회·소진한다. Data 의 read-only export 로 구
     * 후보를 «보기»는 하되 그 행을 Neon 으로 밀어 넣지 않는다 — 임의 이중 소진 구현 금지.
     */
    private boolean importContractReady;

    /** 이관 식별자. 호환 소진·백필이 같은 값을 공유해야 표시·감사가 맞는다. */
    private String migrationId;

    /** 구 앱 match 전체 예산 — `deferredInvite.ts:100` 의 5초. 상류 재시도까지 여기 들어간다. */
    private Duration matchBudget = Duration.ofMillis(4500);

    /** 구 앱 claim 전체 예산 — `api.ts:215-218` 의 15초보다 안쪽. */
    private Duration claimBudget = Duration.ofMillis(13000);

    /**
     * claim 동기 확정이 실패했을 때 <b>{@code 202} + 내구 큐</b>로 접어도 되는가. 기본 false.
     *
     * <p><b>왜 기본값이 꺼짐인가.</b> {@code 202} 는 「나중에 누가 끝낸다」는 약속인데, 그 재개 주체는
     * 이관 재개 단계에 운영자가 실행하는 일회성 CLI({@code business.claim-replay.enabled})뿐이다.
     * Business 에는 크론이 없고(§6) Data 는 링크를 relay 허용목록 밖으로 부를 수 없으므로(§3),
     * <b>이 플래그가 꺼진 평상시에 202 를 주면 아무도 그 큐를 비우지 않아 영구 대기가 된다</b>.
     *
     * <p>평상시의 실패는 그대로 5xx 로 올린다 — 앱의 내구 재시도와 구분되어야 한다. 큐에 적재된
     * 의도는 남지만, 그것을 「완료」로 위장하지 않는다.
     *
     * <p>정지 창(§7.2 3~5단계)에만 켜고, <b>CLI 로 미완료 0 을 확인한 뒤 끈다</b>.
     */
    private boolean claimQueueReplayEnabled;
}
