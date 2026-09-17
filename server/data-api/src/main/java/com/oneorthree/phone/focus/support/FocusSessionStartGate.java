package com.oneorthree.phone.focus.support;

/**
 * 집중 세션 <b>시작</b> 게이트 (GROMO-1764) — v0.3 수명주기 경로 전체의 활성화 스위치라 항상 닫혀 있다.
 *
 * <p><b>왜 시작을 막는가.</b> {@link FocusRewardPolicyGate} 가 닫혀 있어 {@code finish} 는 항상 503 이다.
 * 그런데 시작만 열어 두면 사용자는 <b>끝낼 수 없는 세션</b>에 갇힌다:
 * <ol>
 *   <li>세션을 시작한다 → {@code finish} 가 503 이라 끝낼 수 없다</li>
 *   <li>v0.3 상세가 달린 세션은 12시간 orphan 스윕에서 제외돼(LLD §5) 자동 마감도 되지 않는다</li>
 *   <li>다음 {@code start} 는 열린 기본 마커 때문에 {@code SESSION_IN_PROGRESS} 로 막힌다</li>
 * </ol>
 * 끝낼 수 없는 엔드포인트는 열어 두지 않는다. 시작이 막히면 진행 행 자체가 생기지 않으므로 레거시
 * 간섭·프레즌스 누락·라이브 랭킹 오차·탈퇴 잔존 개인정보가 <b>동시에</b> 무력화된다.
 *
 * <p><b>이 게이트를 여는 날의 선행 조건</b> — 전부 이 티켓 밖이고, 하나라도 빠지면 위 무력화가 풀린다:
 * <ol>
 *   <li><b>현재 섬 컨텍스트를 채우는 경로</b>. {@code UserIslandContextLockService.lock} 은
 *       {@code currentIslandId=null} 인 행을 새로 만들고 V57 에 backfill 이 없어, 지금 start 는 어차피
 *       {@code ISLAND_NOT_CURRENT} 로 무조건 롤백된다. GROMO-1759 가 {@code PUT /me/current-island} 로
 *       채운다</li>
 *   <li><b>레거시 {@code FocusService.startFocusSession} 이 상세 있는 세션을 닫지 못하게</b> 한다.
 *       {@code autoCloseOpenMarkersOf} 가 그 사용자의 열린 마커를 조건 없이 전부 닫아, v0.3 상세만
 *       진행 중으로 남는다(이 클래스가 아니라 {@code abandonIfMarkerClosed} 가 사후 수습 중이다)</li>
 *   <li><b>레거시 {@code FocusService.saveFocusSession} 의 중복 적립 차단</b>. 구 앱의 오프라인 업로드가
 *       v0.3 세션과 겹치는 블록을 별도 {@code COMPLETED} 마커로 적립한다</li>
 *   <li><b>리그 라이브 랭킹이 휴식을 빼게</b> 한다. {@code LeagueRankingQueryRepository} 의
 *       {@code LIVE_SESSIONS}/{@code LIVE_SECONDS} 가 {@code now - started_at} 이라 paused 동안도 쌓인다</li>
 *   <li><b>집중 프레즌스 리스 기록</b>. {@code FocusPresencePort.focusStarted} 를 부르지 않아
 *       {@code ChatAccessGuard} 의 집중 중 채팅 차단을 그대로 우회한다</li>
 *   <li><b>보상 정책 FR-D01~06</b> — {@link FocusRewardPolicyGate} 가 같이 열려야 finish 가 산다</li>
 *   <li><b>멤버십을 «잠근 뒤» 전이한다.</b> 지금 {@code authorizeSession} 의 섬 멤버십 검사는 잠금 없는
 *       조회다. 그 조회를 통과한 직후 {@code GroupMemberService.kickMember} 나 탈퇴가 멤버십 행을 잠그고
 *       커밋하면, 이 요청은 그대로 상세·구간을 바꾸고 outbox 까지 적재한다 — 강퇴가 «먼저» 끝났는데도
 *       그 사용자의 전이가 남는다. 멤버십 writer 와 같은 잠금 아래에서 다시 확인해야 한다.
 *       지금 락을 더하지 않은 것은 의도다: LLD §4 의 전역 잠금 순서와 맞추는 작업이라 게이트를 여는
 *       변경과 같이 가야 하고, 도달하지 않는 경로에 락부터 심으면 순서를 검증할 방법이 없다</li>
 *   <li><b>start 가 rest 투영 삭제 이벤트도 적재한다.</b> pause 된 세션이 레거시 마커 종료로
 *       {@code ABANDONED} 로 정리되면 그 세션의 {@code rest.member.updated} 삭제가 나가지 않는다.
 *       그 뒤 새 세션을 시작해도 이 경로는 {@code focus.member.updated} 만 적재하므로, Realtime 이 켜진
 *       뒤에는 클라이언트의 rest 투영에 옛 {@code sessionId}·{@code restSeat} 가 남아 새 focus 상태와
 *       «함께» 보인다. 지금은 {@code REALTIME} transport 자체가 등록돼 있지 않아 어떤 이벤트도 전달되지
 *       않으므로 전달 배선과 같이 정한다</li>
 * </ol>
 *
 * <p>{@link FocusRewardPolicyGate} 와 같은 모양(순수 상수 판정, 주입 없음)이지만 <b>별개 상수</b>다 —
 * 막는 사유가 다르고, 둘 중 하나만 먼저 여는 날 구분이 필요하다.
 */
public final class FocusSessionStartGate {

    private FocusSessionStartGate() {
    }

    /**
     * @return v0.3 집중 세션 시작 경로가 열려 있는가. 위 선행 조건 여섯이 갖춰지기 전까지 항상
     *         {@code false} 다
     */
    public static boolean isOpen() {
        return false;
    }
}
