package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * 집중 세션을 id 로 조회하는 경로를 접는다 (GROMO-1655). 규약은
 * {@code docs/conventions/backend-layering.md} §3.
 *
 * <p><b>여기 있는 것은 하나뿐이다.</b> focus 의 조회는 대부분 유저·기간·상태가 얽힌 범위 스캔이거나
 * {@code findByIdAndUserForUpdate} 처럼 <b>소유자 검증을 쿼리에 접은 복합 조회</b>라 §3 「옮기지 않는
 * 것」에 해당한다. id 단건 조회는 세션 상세·삭제 두 자리뿐이고, 둘 다 부재를 같은 코드로 거절한다.
 *
 * <p>호출부 둘이 <b>같은 클래스</b>({@code FocusService} 의 종료·취소)라 여러 service 간 갈림을 막는
 * 효과는 없다. 그래도 계층에 둔 것은 §3·GROMO-1655 의 "조회 계층 밖 id 조회 0건" 목표 때문이고,
 * 그 덕에 <b>락 등급 선택이 한 곳에 고정</b>된다 — 같은 리포지토리의 배타 락 판과 갈리는 자리다.
 *
 * <p><b>트랜잭션을 시작하지 않는다.</b> 호출한 service 의 트랜잭션에 참여한다.
 */
@Service
@RequiredArgsConstructor
public class FocusQueryService {

    private final FocusSessionRepository focusSessionRepository;

    /**
     * 집중 세션 단건 — 락 없음.
     *
     * <p><b>소유자를 검증하지 않는다.</b> 남의 세션 id 를 끼워 넣는 것을 막는 것은 호출부의 일이고,
     * 잠금이 필요한 자리는 소유자까지 쿼리에 접은
     * {@link FocusSessionRepository#findByIdAndUserForUpdate} 를 직접 쓴다.
     *
     * @param sessionId 조회 대상
     * @return 세션
     * @throws FocusException 없으면 {@link FocusErrorCode#SESSION_NOT_FOUND}
     */
    public FocusSession getFocusSession(UUID sessionId) {
        return focusSessionRepository.findById(sessionId)
                .orElseThrow(() -> new FocusException(FocusErrorCode.SESSION_NOT_FOUND));
    }
}
