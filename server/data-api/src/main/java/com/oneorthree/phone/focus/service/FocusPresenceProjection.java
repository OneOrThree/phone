package com.oneorthree.phone.focus.service;

import com.oneorthree.phone.common.port.FocusPresencePort;
import com.oneorthree.phone.common.port.FocusPresenceState;
import com.oneorthree.phone.focus.dto.session.FocusSessionView;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

/**
 * 집중 프레즌스를 적는 <b>유일한 자리</b> (GROMO-2003 · focus-rest-session LLD §6).
 *
 * <p><b>왜 한 자리여야 하는가.</b> 「지금 이 사람이 집중 중이다」는 두 곳에 나간다 — 섬 화면이 읽는
 * {@code focus/rest.member.updated} 사건(내구 outbox, <b>같은 트랜잭션</b>)과 채팅이 읽는 공유 Redis 리스
 * ({@link FocusPresencePort}, <b>커밋 이후</b>). 종전에는 전이마다 호출부가 둘을 각각 불렀고,
 * 그 호출부가 {@code FocusService} 7곳 · {@code FocusSessionLifecycleService} 3곳 ·
 * {@code FocusPresenceReconciler} 2곳 · {@code FocusMembershipLossService} 1곳으로 흩어져 있었다.
 * 흩어진 이중 배선의 대가는 <b>반쪽 기록</b>이다 — 새 종료 경로를 하나 더 만들면서 사건만 적고 리스를
 * 안 지우면, 그 사람은 집중이 끝났는데도 리스 TTL(최대 13시간) 내내 채팅에 못 들어간다. 그 구멍은
 * 코드를 읽어서는 보이지 않는다(두 호출이 서로를 모른다). 한 호출로 묶으면 «빠뜨릴 자리»가 사라진다.
 *
 * <p>LLD §6 이 적어 둔 「기존 RedisFocusPresence 와 새 도메인 producer 가 각각 직접 쓰는 이중 배선을
 * 두지 않고 하나의 Data projection 포트로 통합한다」가 이것이다.
 * {@code architecture/DomainLayerRulesTest} 가 「이 클래스 말고는 {@link FocusPresencePort} 도
 * {@link FocusMemberEvents} 도 부르지 않는다」를 빌드 실패로 고정한다.
 *
 * <p><b>왜 이벤트가 아니라 «부르는» 포트인가.</b> 섬 투영은 상태 전이와 <b>같은 트랜잭션</b>에 적혀야
 * 한다(사건이 따로 커밋되면 「세션은 끝났는데 섬 목록엔 남아 있다」가 영구화된다). 트랜잭션 경계를
 * 공유해야 하는 기록은 in-process {@code ApplicationEvent} 로 뒤집을 수 없다 — 티켓 1995 의
 * {@code IslandPurgePort} 가 같은 이유로 포트가 됐다.
 *
 * <p><b>이 도메인에 있는 이유.</b> 부르는 쪽은 {@code focus}(L2) 셋과 {@code internal}(L10) 하나다.
 * L2 에 두면 넷이 모두 «아래로» 부른다 — {@code internal} 에 두면 {@code focus} → {@code internal} 이
 * 역행이 된다. {@link FocusMemberEvents} 가 여기 있는 이유와 같다.
 *
 * <h2>레거시 마커에는 섬이 없다</h2>
 * 1.x 의 {@code focus_sessions} 마커는 섬에 묶이지 않아 적을 섬 투영이 없다. 그래서 그 경로는
 * {@link #legacyMarkerStarted}·{@link #legacyMarkerEnded} 로 <b>리스만</b> 적는다 — 없는 사건을
 * 지어내지 않는다. controlVersion 은 {@code 0} 이다(상세가 없어 전이 번호가 없다).
 *
 * <p>사건 목록을 {@link Arrays#asList} 로 돌려주는 것은 의도다. {@code List.of} 는 null 원소를 거부하는데,
 * 봉투는 「명령 결과에 실어 보내는 값」이라 {@code OutboxCommandPort} 를 목으로 둔 단위 테스트에서 null 로
 * 온다 — 종전 {@code settle} 의 {@code ArrayList} 도 그것을 허용했다. 여기서 NPE 를 새로 만들지 않는다.
 */
@Service
@RequiredArgsConstructor
public class FocusPresenceProjection {

    /** 상세가 없는 경로(레거시 마커)의 controlVersion. 세션 안의 전이 번호가 없다는 뜻이다. */
    private static final long NO_CONTROL_VERSION = 0L;

    private final FocusMemberEvents focusMemberEvents;
    private final FocusPresencePort focusPresencePort;

    /**
     * v0.3 세션이 <b>진행 중 상태로</b> 전이했다 — 시작·휴식(pause)·재개(resume) 공용.
     *
     * <p>셋을 한 메서드로 둔 이유는 적는 내용이 같기 때문이다: focus 목록의 내 행 + rest 목록의 내 행 +
     * 리스의 절대 상태. 무엇이 달라지는가는 전부 {@code view} 안에 있다 — {@code status} 가 상태를,
     * {@code restStartedAt} 이 휴식 시작 시각을 들고 있다. 메서드를 셋으로 가르면 같은 본문이 세 벌이 되고,
     * 그중 하나만 고치는 순간 다시 이 티켓이 고친 종류의 어긋남이 생긴다.
     *
     * <p>리스의 TTL 기준은 <b>세션 시작 시각</b>({@code view.startedAt()})이지 이번 전이 시각이 아니다 —
     * 「놓는 시점부터 13시간」으로 잡으면 휴식·재개를 반복할수록 백스톱이 뒤로 밀린다.
     *
     * @param restSeat 휴식 자리. {@code paused} 일 때만 값이 있고 나머지는 {@code null}(= rest 목록에서 제거)
     * @param presenceOrder 그 세션의 {@code focus_sessions.presence_order}
     * @return 호출측이 명령 결과에 실을 사건 둘(focus · rest 순서)
     */
    public List<EventEnvelope> progressing(UUID userId, UUID islandId, FocusSessionView view, Integer restSeat,
                                           Long presenceOrder) {
        boolean paused = FocusSessionView.STATUS_PAUSED.equals(view.status());
        EventEnvelope focusEvent = focusMemberEvents.focusUpdated(userId, islandId, view.id(), view.status(),
                view.subject(), view.activeSeconds(), view.serverNow(), view.version());
        EventEnvelope restEvent = focusMemberEvents.restUpdated(userId, islandId, view.id(), view.status(),
                paused ? view.restStartedAt() : null, paused ? restSeat : null, view.serverNow(), view.version());
        focusPresencePort.focusStateChanged(userId, presenceOrder, view.version(),
                paused ? FocusPresenceState.PAUSED : FocusPresenceState.ACTIVE, view.startedAt());
        return Arrays.asList(focusEvent, restEvent);
    }

    /**
     * v0.3 세션이 <b>끝났다</b> — 정상 정산·자동 종료·포기(마커 desync 정리)·소속 상실 공용.
     *
     * <p>넷을 한 메서드로 둔 이유는 LLD §6 이 「focus 완료는 목록에서 제거」 하나만 정의했기 때문이다.
     * 종결 «사유»는 {@code focus_session_details.lifecycle} 에 남고, 투영에는 남지 않는다 — 섬 화면에는
     * 「그 사람이 더 이상 앉아 있지 않다」만 보이면 된다. 사유별 상태값을 새로 만들면 소비측이 같은
     * {@code (projection, islandId, userId)} 축으로 합치지 못한다.
     *
     * @param controlVersion 종결 전이 뒤의 {@code focus_session_details.version}
     * @param presenceOrder 그 세션의 순번. 리스 해제는 controlVersion 을 보지 않는다({@link FocusPresencePort})
     * @return 호출측이 명령 결과에 실을 사건 둘(focus · rest 순서)
     */
    public List<EventEnvelope> ended(UUID userId, UUID islandId, UUID sessionId, String subject,
                                     long activeSeconds, Instant serverNow, long controlVersion,
                                     Long presenceOrder) {
        EventEnvelope focusEvent = focusMemberEvents.focusUpdated(userId, islandId, sessionId,
                FocusMemberEvents.STATUS_COMPLETED, subject, activeSeconds, serverNow, controlVersion);
        EventEnvelope restEvent = focusMemberEvents.restUpdated(userId, islandId, sessionId,
                FocusMemberEvents.STATUS_COMPLETED, null, null, serverNow, controlVersion);
        focusPresencePort.focusEnded(userId, presenceOrder);
        return Arrays.asList(focusEvent, restEvent);
    }

    /**
     * 레거시 1.x 마커가 열렸다 — 섬이 없어 리스만 적는다.
     *
     * @param startedAt 그 마커가 시작한 시각(리스 만료 기준)
     */
    public void legacyMarkerStarted(UUID userId, Long presenceOrder, Instant startedAt) {
        focusPresencePort.focusStateChanged(userId, presenceOrder, NO_CONTROL_VERSION,
                FocusPresenceState.ACTIVE, startedAt);
    }

    /** 레거시 1.x 마커가 닫혔다(정상 종료·취소·POST 폴백 선점·고아 스윕·회전) — 리스만 지운다. */
    public void legacyMarkerEnded(UUID userId, Long presenceOrder) {
        focusPresencePort.focusEnded(userId, presenceOrder);
    }

    /** 탈퇴 — 리스·종료 표식을 지우고 tombstone 을 남긴다(GROMO-1943). 섬 투영은 강퇴 경로가 이미 적었다. */
    public void userWithdrawn(UUID userId) {
        focusPresencePort.userWithdrawn(userId);
    }

    /**
     * 리컨실 재구축 — 정본을 읽어 <b>비어 있는</b> 리스만 채운다. 사건은 내지 않는다(이미 적힌 정본이다).
     *
     * @return {@code false} 면 저장소가 흔들린다 — 부르는 쪽은 남은 건을 이어 가지 않는다
     */
    public boolean restoreLeaseIfMissing(UUID userId, Long presenceOrder, long controlVersion,
                                         FocusPresenceState state, Instant startedAt) {
        return focusPresencePort.restoreLeaseIfMissing(userId, presenceOrder, controlVersion, state, startedAt);
    }

    /**
     * 리컨실 되묻기 — 그 사이 끝난 세션의 리스를 지금 지우고 <b>지웠는지</b>를 돌려준다.
     *
     * @return {@code false} 면 다시 시도해야 한다
     */
    public boolean releaseLeaseNow(UUID userId, Long presenceOrder) {
        return focusPresencePort.releaseLeaseNow(userId, presenceOrder);
    }
}
