package com.oneorthree.phone.focus.service;

import com.oneorthree.phone.common.support.BannedWords;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.focus.repository.SeaRemarkRepository;
import com.oneorthree.phone.focus.repository.domain.SeaRemark;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import com.oneorthree.phone.user.repository.UserQueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

/**
 * 바다 한마디 (GROMO-2299, 결정 N10) — 5분 잠금 · 변경 사건 발행을 Data 가 소유한다. 게스트 403 은 내부 컨트롤러가
 * {@code GuestAccountGuards} 로 서비스 앞에서 막는다(방명록과 같은 자리).
 *
 * <p>지움(빈 문자열)도 «변경» 이다 — 행을 지우면 {@code changedAt} 이 사라져 지웠다 쓰기를 반복해 5분 잠금을 우회할 수
 * 있으므로, 지운 상태는 빈 문자열 행으로 남기고 응답·조회에서만 null 로 보인다. 탈퇴 때는 행을 진짜로 지운다.
 */
@Service
@RequiredArgsConstructor
public class SeaRemarkService {

    /**
     * @param remark      바뀐 한마디. 지웠으면 null
     * @param changedAt   변경 시각
     * @param lockedUntil 이 시각 전에는 다시 바꿀 수 없다
     */
    public record SeaRemarkView(String remark, Instant changedAt, Instant lockedUntil) {
    }

    /** 직전 변경 뒤 이 시간 안에는 다시 바꿀 수 없다. */
    public static final Duration LOCK = Duration.ofMinutes(5);

    private final UserQueryService userQueryService;
    private final SeaRemarkRepository remarks;
    private final OutboxCommandPort outbox;
    private final SeaSessionEvents events;
    /** 방명록·공지와 같은 금칙어 목록 — 걸리면 같은 코드 {@code BANNED_WORD}(400). */
    private final BannedWords bannedWords;
    private final Clock clock;

    /**
     * @param remark 이미 정규화된 값({@code SeaRemarkRequest}) — 빈 문자열은 지움
     * @throws FocusException 5분 안 재변경이면 409 {@code SEA_REMARK_LOCKED}
     */
    @Transactional
    public SeaRemarkView update(UUID userId, String remark) {
        bannedWords.requireClean(remark);
        // 같은 사용자의 동시 변경 두 건이 둘 다 잠금을 통과하거나 첫 INSERT 가 겹치지 않게 사용자 행을 배타로 잡는다.
        userQueryService.getCallerForUpdate(userId);
        Instant now = clock.instant();
        SeaRemark current = remarks.findById(userId).orElse(null);
        if (current != null && now.isBefore(current.getChangedAt().plus(LOCK))) {
            throw new FocusException(FocusErrorCode.SEA_REMARK_LOCKED);
        }
        if (current == null) {
            remarks.save(new SeaRemark(userId, remark, now));
        } else {
            current.change(remark, now);
        }
        String shown = remark.isEmpty() ? null : remark;
        events.remark(userId, shown, now);
        return new SeaRemarkView(shown, now, now.plus(LOCK));
    }

    /** 탈퇴 파기 — 사용자 행이 익명화만 되어 FK 연쇄 삭제가 돌지 않으므로 직접 지운다. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void eraseWithdrawnUser(UUID userId) {
        remarks.deleteAllOfUser(userId);
        // 변경 사건 params.remark 에 자유 입력 원문이 복제돼 있다 — 아직 안 나간 봉투 본문은 바꾸지 않고 남는다
        // (OutboxCommandPort#eraseWithdrawnParam, outbox-events.md 개인정보 파기).
        outbox.eraseWithdrawnParam(userId, SeaSessionEvents.EVENT_TYPE, "remark");
    }
}
