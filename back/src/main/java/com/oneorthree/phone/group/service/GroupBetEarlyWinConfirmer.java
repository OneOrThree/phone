package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.event.GroupBetWonEvent;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.user.domain.User;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * 이벤트 기반 개인 승리 조기 확정(GROMO-1268, N11) — 집중 세션이 서버에 도착한 트랜잭션에
 * <b>편승</b>해, 그 날짜의 <b>FOCUS</b> OPEN 회차에서 해당 유저의 달성을 즉시 확정한다(불가역 —
 * FR-23). 호출자는 {@code FocusService}(세션 저장·라이브 종료)이고, 통계 반영 <b>이후</b>에 불러야
 * 판정이 방금 기록을 본다.
 *
 * <p><b>FOCUS 만</b> — 조기 확정이 SCREEN_TIME 까지 불가역 확정하면, 집중 세션 하나 기록했을 뿐인데
 * 같은 날 SCREEN_TIME 회차가 그 시점 사용량으로 승리 확정되고 이후 목표 초과가 정산에서 뒤집히지
 * 못한다(8차 리뷰 반영 — LLD §5.1). 대상 선정은 회차 미션 스냅샷의 카테고리로 거른다.
 *
 * <p><b>잠금 규율(LLD §5.1·§5.4)</b>: 대상 회차를 {@code session.id} 오름차순으로 <b>전부 먼저</b>
 * 잠근 뒤 판정한다 — 리포지토리 반환 순서대로 하나씩 잠그면 탈퇴 연동({@code releaseSessions})처럼
 * 오름차순으로 도는 경로와 교차 데드락이 난다. 잠금 획득 후 참가 행을 <b>다시 읽는다</b> — 잠금을
 * 기다리는 동안 취소(5분 유예)가 그 행을 지웠을 수 있고, 낡은 스냅샷을 수정하면 flush 실패로
 * 집중 세션 저장 트랜잭션 전체가 롤백된다(남의 취소 때문에 내 집중 기록이 사라지는 셈).
 *
 * <p>정산과 같은 회차 락을 잡는 이유: 락 없이 참가 행을 바꾸면 {@code settle()} 이 "미달성" 지급을
 * 끝낸 뒤에 이 트랜잭션의 {@code achieved=true} 가 커밋돼 저장된 결과와 실제 지급이 어긋난다.
 * 락 획득 후 {@code status != OPEN} 이면 이미 정산된 회차이므로 아무것도 하지 않는다.
 *
 * <p>전원 확정 검사는 여기서 하지 않는다 — {@link GroupBetWonEvent} 를 발행하고
 * {@code AFTER_COMMIT} 리스너({@link GroupBetEarlySettlementListener})가 커밋된 상태 기준으로
 * 본다(트랜잭션 안 검사는 마지막 두 명 동시 확정 때 write skew 로 둘 다 건너뛴다 — LLD §5.1).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class GroupBetEarlyWinConfirmer {

    private final GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    private final GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    private final GroupBetJudge groupBetJudge;
    private final ApplicationEventPublisher eventPublisher;

    /**
     * 집중 기록 반영 직후 호출(같은 트랜잭션) — {@code dates} 는 이번 세션이 통계에 귀속된 날짜들이다
     * (자정 걸침 세션은 2일). 실패가 집중 세션 저장을 되돌리면 안 되는 부가 경로이므로, 판정 불가
     * (CTI 유실 등)는 건너뛰고 예외는 삼키지 않는다 — 여기서 나는 예외는 잠금·flush 계열이라 삼켜도
     * 트랜잭션은 이미 rollback-only 다.
     */
    public void confirmWins(User user, Collection<LocalDate> dates) {
        if (dates.isEmpty()) {
            return;
        }
        List<GroupChallengeBetParticipant> targets = groupChallengeBetParticipantRepository
                .findUnconfirmedOpenFocusByUserAndDates(user.getId(), dates);
        if (targets.isEmpty()) {
            return;
        }

        // 회차 락을 오름차순으로 전부 먼저 잡는다(§5.4) — 쿼리가 s.id ORDER BY 를 보장하지만
        // 방어적으로 한 번 더 정렬한다.
        Map<UUID, GroupChallengeBetSession> locked = new LinkedHashMap<>();
        targets.stream()
                .map(p -> p.getSession().getId())
                .distinct()
                .sorted()
                .forEach(sessionId -> groupChallengeBetSessionRepository.findByIdForUpdate(sessionId)
                        .ifPresent(s -> locked.put(sessionId, s)));

        for (GroupChallengeBetParticipant target : targets) {
            GroupChallengeBetSession session = locked.get(target.getSession().getId());
            if (session == null || !session.isOpen()) {
                continue;   // 이미 정산됨 — 건드리지 않는다.
            }
            // 락 이후 참가 행 재조회(§5.4) — 대기하는 사이 취소로 사라졌을 수 있다.
            Optional<GroupChallengeBetParticipant> current =
                    groupChallengeBetParticipantRepository.findById(target.getId());
            if (current.isEmpty() || current.get().getAchieved() != null) {
                continue;
            }
            GroupChallengeBetParticipant participant = current.get();
            // 판정 기준은 회차 박제 스냅샷(GROMO-1263) — 정산({@code GroupBetSettler})이 쓰는
            // 것과 <b>같은 커널·같은 대상</b>이라 조기 확정과 최종 정산이 갈릴 수 없다(GROMO-1280).
            // 스냅샷도 CTI 도 없으면 판정 불가 — 조기 확정만 건너뛴다(정산은 어차피 같은 이유로
            // 실패·백오프를 탄다. 집중 저장을 막을 이유가 없다).
            Optional<GroupBetJudge.Target> target0 = groupBetJudge.ofSession(session);
            if (target0.isEmpty()) {
                continue;
            }
            Integer minutes = groupBetJudge
                    .progressMinutes(target0.get(), session.getSessionDate(), List.of(user))
                    .get(user.getId());
            if (GroupBetJudge.isAchieved(target0.get(), minutes)) {
                participant.confirmWin(minutes == null ? 0 : minutes);
                eventPublisher.publishEvent(
                        new GroupBetWonEvent(session.getId(), participant.getId()));
                log.info("개인 승리 조기 확정 — sessionId={}, userId={}, progressMinutes={}",
                        session.getId(), user.getId(), minutes);
            }
        }
    }
}
