package com.oneorthree.phone.focus.support;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 집중 세션 <b>시작</b> 게이트 (GROMO-1764 · GROMO-1924) — v0.3 수명주기 경로 전체의 활성화 스위치다.
 *
 * <p><b>기준.</b> GROMO-1764 는 이 게이트를 상수 {@code false} 로 닫았다 — finish 가 늘 503 이라 시작만 열면
 * 사용자가 끝낼 수 없는 세션에 갇혔기 때문이다. GROMO-1924 가 아래 선행 조건 아홉을 풀고, 게이트를 배포 설정
 * {@code focus.session.start-enabled}(기본 {@code false}, dev·prod 는 {@code FOCUS_SESSION_START_ENABLED})로
 * 바꿨다 — LLD §5.2 의 「새 세션 생성의 활성화 flag」다. 끄면 새 start 만 503 이고 이미 진행 중인 세션의
 * pause/resume/finish 는 그대로 열려 있다. 현재 보상 정책 revision 이 없어도 start 는 같은 503 이다
 * ({@code FocusSessionLifecycleService} 참조).
 *
 * <h2>선행 조건 아홉 — 해소 여부와 근거</h2>
 * <ol>
 *   <li><b>현재 섬 컨텍스트를 채우는 경로</b> — <b>해소</b>(GROMO-1759, 이미 main). 섬 생성과
 *       {@code PUT /me/current-island} 가 {@code currentIslandId} 를 쓴다.</li>
 *   <li><b>레거시 start 가 v0.3 세션을 닫지 못하게</b> — <b>해소</b>. v0.3 진행 세션이 있으면 레거시
 *       {@code startFocusSession} 은 409 다(마커 회전 전에 막는다). v0.3 세션 PK 로 온 레거시 PATCH·취소는
 *       409, POST 업로드는 그 마커를 선점하지 않는다.</li>
 *   <li><b>레거시 오프라인 업로드의 중복 적립</b> — <b>해소</b>. v0.3 서버 구간과 겹치는 블록은 저장·통계·지급
 *       없이 중복 재업로드와 같은 성공으로 답한다(구 앱 대기열이 비워진다).</li>
 *   <li><b>리그 라이브 랭킹이 휴식을 빼게</b> — <b>서버 해소</b>. active 는 순수 ACTIVE 합으로 합성한 앵커로
 *       정렬·표시가 함께 맞고, paused 는 라이브에서 빠진다(친구 라이브 표시도 같은 규칙). <b>남은 것</b>: 휴식
 *       중에도 진행분을 «고정 표시»하려면 응답·앱 계약 개정이 필요하다(LLD §5.1 앱 쪽, 이 서버 티켓 밖).</li>
 *   <li><b>집중 프레즌스 리스</b> — <b>해소(active)</b>. start 가 레거시와 같은 포트·키로 리스를 놓고
 *       finish·소속 상실·마커 desync 정리가 지운다. <b>미해소 — 제품 결정 FR-D04</b>(휴식 중 채팅 허용)가
 *       없어 pause/resume 은 리스를 건드리지 않는다(세션이 끝날 때까지 채팅 차단 유지 — 레거시 리컨실러의
 *       열린 마커 복구와 같은 규칙). FR-D04 가 «휴식 중 허용»으로 정해지면 pause/resume 이 리스를 오가게
 *       되고, 그때 LLD §6 의 사용자별 controlVersion CAS 가 필요해진다 — 지금은 같은 sessionId 의
 *       active→paused→active 역순 문제가 생기지 않는다.</li>
 *   <li><b>보상 정책</b> — <b>해소</b>. finish 가 2026-09-18 결정 D5(60초당 1마리 · 주민·섬별 하루 480마리)와
 *       2026-09-19 D5-귀속-개정(섬 통장 100% · 개인 0%)으로 정산한다. 값은 {@code focus_reward_policies} revision 이고 세션이
 *       시작 때 고정한다. {@code FocusRewardPolicyGate} 는 없앴다. <b>남은 것</b>: 퀘스트 진행률(1772/1773
 *       계약 없음 — 빈 목록), 레거시 일일 목표 코인·스트릭·내기 연계의 새 세션 적용(LLD §4 출시 의존),
 *       개인 지갑 {@code wallet.updated} 사건(소비자·순서 축 미정).</li>
 *   <li><b>멤버십을 잃은 진행 세션의 탈출 경로</b> — <b>해소</b>(2026-09-18 결정 FR-D03 = B1). 강퇴 TX 가 같은
 *       잠금 아래 진행 세션을 {@code MEMBERSHIP_LOST} 로 종결하고 정산하지 않는다. 자진 탈퇴는 진행 세션이
 *       있으면 409(「먼저 끝내고 나가라」).</li>
 *   <li><b>멤버십을 «잠근 뒤» 전이</b> — <b>해소</b>. 전이·start 가 섬 행 → 멤버십(공유) → 상세 순으로
 *       잠가 강퇴와 섬 행에서 줄을 선다(LLD §3).</li>
 *   <li><b>start 의 rest 투영 제거 사건</b> — <b>해소</b>. start 가 rest.member.updated(active·자리 null)를
 *       같은 TX 에 적재하고, 마커 desync 로 정리된 세션도 그 섬의 목록에서 지우는 사건을 남긴다.</li>
 * </ol>
 *
 * <h2>운영에서 켜기 전에 남은 것 — 이 스위치가 기본 {@code false} 인 이유</h2>
 * 아래는 제품 결정이나 앱·배포 작업이라 이 티켓이 지어내지 않았다. 전부 닫히기 전에는 운영에서 켜지 않는다.
 * <ul>
 *   <li><b>FR-D04</b> 휴식 중 채팅·구독 정책(위 #5) — policy.md 「결정 전 활성화 금지」</li>
 *   <li><b>FR-D05</b> 응원 TTL·빈도 — emote 는 data-api 경로가 아니지만 같은 기능 묶음의 활성화 조건이다</li>
 *   <li><b>FR-D06</b> 목표 시간·subject 허용 범위와 <b>v0.3 세션의 orphan·종료 정책</b> — v0.3 세션은 12시간
 *       스윕에서 빠지므로(LLD §5) 정리 주체가 없으면 방치된 세션이 끝나지 않는다</li>
 *   <li>LLD §5.1.1 완료 목록 호환 — 레거시 {@code GET /api/v1/focus-session} 은 v0.3 완료 마커의 시작~끝을
 *       그대로 내려 구 앱 시간표·최장 세션이 휴식을 포함한다(호환 앱 또는 검증된 projection 필요)</li>
 *   <li>LLD §5.2 호환 baseline 배포와 비호환 구 이미지 롤백 차단</li>
 *   <li><b>GROMO-1990 의 nullable {@code target_minutes}</b> — 목표 없는 세션이 생기면 옛 data-api
 *       엔티티({@code int})와 옛 business DTO({@code 필수 int})가 그 세션을 못 읽는다(500/502).
 *       <b>두 서비스에 새 버전을 전량 배포한 뒤</b> 이 스위치를 켠다. 이미 켜져 있다면 롤링 배포 동안
 *       먼저 끈다 — 꺼져 있으면 v0.3 세션 행 자체가 안 생겨 null 을 쓸 경로가 없다</li>
 * </ul>
 */
@Component
public class FocusSessionStartGate {

    private final boolean enabled;

    public FocusSessionStartGate(@Value("${focus.session.start-enabled:false}") boolean enabled) {
        this.enabled = enabled;
    }

    /**
     * @return v0.3 집중 세션 시작 경로가 열려 있는가 — 배포 설정 그대로다
     */
    public boolean isOpen() {
        return enabled;
    }
}
