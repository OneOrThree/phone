package com.oneorthree.phone.focus.service;

import com.oneorthree.phone.common.port.FocusPresencePort;
import com.oneorthree.phone.common.port.FocusPresenceState;
import com.oneorthree.phone.focus.dto.session.FocusSeat;
import com.oneorthree.phone.focus.dto.session.FocusSessionView;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

/**
 * 집중 상태의 섬 투영과 공유 Redis 리스를 함께 갱신하는 진입점.
 *
 * <p>섬의 {@code focus/rest.member.updated} 사건은 상태 전이와 같은 트랜잭션에 기록하고,
 * {@link FocusPresencePort}는 커밋 이후 리스를 반영한다. 세션 전이·소속 상실·재구축은 이 클래스를
 * 거쳐 두 기록의 누락을 방지한다. {@code DomainLayerRulesTest}가 직접 호출 경계를 검사한다.
 *
 * <p>반환 목록은 {@link Arrays#asList}를 사용해 테스트 대역이 반환하는 null 사건 봉투도 허용한다.
 */
@Service
@RequiredArgsConstructor
public class FocusPresenceProjection {



    private final FocusMemberEvents focusMemberEvents;
    private final FocusPresencePort focusPresencePort;

    /**
     * 세션이 <b>진행 중 상태로</b> 전이했다 — 시작·휴식(pause)·재개(resume) 공용.
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
     * @param seat 집중섬에서 앉은 자리(GROMO-2477) — 시작 때 저장한 값 그대로, 자리 없이 시작했으면 {@code null}
     * @param presenceOrder 그 세션의 {@code focus_sessions.presence_order}
     * @return 호출측이 명령 결과에 실을 사건 둘(focus · rest 순서)
     */
    public List<EventEnvelope> progressing(UUID userId, UUID islandId, FocusSessionView view, Integer restSeat,
                                           FocusSeat seat, Long presenceOrder) {
        boolean paused = FocusSessionView.STATUS_PAUSED.equals(view.status());
        EventEnvelope focusEvent = focusMemberEvents.focusUpdated(userId, islandId, view.id(), view.status(),
                view.subject(), view.activeSeconds(), view.serverNow(), view.version(), seat);
        EventEnvelope restEvent = focusMemberEvents.restUpdated(userId, islandId, view.id(), view.status(),
                paused ? view.restStartedAt() : null, paused ? restSeat : null, view.serverNow(), view.version());
        focusPresencePort.focusStateChanged(userId, presenceOrder, view.version(),
                paused ? FocusPresenceState.PAUSED : FocusPresenceState.ACTIVE, view.startedAt());
        return Arrays.asList(focusEvent, restEvent);
    }

    /**
     * 세션이 <b>끝났다</b> — 정상 정산·자동 종료·포기(마커 desync 정리)·소속 상실 공용.
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
                FocusMemberEvents.STATUS_COMPLETED, subject, activeSeconds, serverNow, controlVersion, null);
        EventEnvelope restEvent = focusMemberEvents.restUpdated(userId, islandId, sessionId,
                FocusMemberEvents.STATUS_COMPLETED, null, null, serverNow, controlVersion);
        focusPresencePort.focusEnded(userId, presenceOrder);
        return Arrays.asList(focusEvent, restEvent);
    }



    /**
     * 바다 세션이 열렸다 (GROMO-2299) — 섬 사건(목적지 섬 주민에게 항해자가 보이면 안 된다)은 내지 않고, 사용자 단위
     * 채팅 게이트 리스만 적는다. 바다 집중도 집중이라 게이트는 섬 세션과 같게 든다(N37).
     */
    public void seaStarted(UUID userId, Long presenceOrder, long controlVersion, Instant startedAt) {
        focusPresencePort.focusStateChanged(userId, presenceOrder, controlVersion, FocusPresenceState.ACTIVE,
                startedAt);
    }

    /** 바다 세션이 끝났다(정산·포기 공용) — 리스만 지운다. 리스를 안 지우면 복원 스케줄러가 13시간 되살린다. */
    public void seaEnded(UUID userId, Long presenceOrder) {
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
