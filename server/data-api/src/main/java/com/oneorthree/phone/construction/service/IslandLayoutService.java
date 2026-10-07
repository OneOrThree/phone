package com.oneorthree.phone.construction.service;

import com.oneorthree.phone.construction.dto.IslandLayoutView;
import com.oneorthree.phone.construction.repository.IslandLayoutRepository;
import com.oneorthree.phone.construction.repository.domain.IslandLayout;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.UUID;

/**
 * 섬 배치 정본의 읽기·revision 증가 (GROMO-2232). 권한 판정은 호출측 몫이다.
 *
 * <p>두 메서드 모두 행이 없으면 기본 템플릿으로 먼저 만든다(지연 생성, 백필 없음) — 쓰기를 동반하므로
 * 호출측의 쓰기 트랜잭션 안에서만 부른다({@code MANDATORY}).
 */
@Service
@RequiredArgsConstructor
@Transactional(propagation = Propagation.MANDATORY)
public class IslandLayoutService {

    private final IslandLayoutRepository layouts;
    private final Clock clock;

    /** 현재 배치 — 동시 첫 조회는 INSERT 가 ON CONFLICT 로 접히고 이긴 쪽 행을 다시 읽는다. */
    public IslandLayoutView current(UUID islandId) {
        layouts.insertIfAbsent(islandId, IslandLayoutTemplate.DEFAULT_LAYOUT_JSON);
        IslandLayout layout = layouts.findById(islandId).orElseThrow();
        return new IslandLayoutView(layout.getLayoutRevision(), layout.getLayout());
    }

    /** 배치 변경(시설 완공) — 행을 잠그고 revision 을 1 올린 값을 돌려준다. */
    public long bumpRevision(UUID islandId) {
        layouts.insertIfAbsent(islandId, IslandLayoutTemplate.DEFAULT_LAYOUT_JSON);
        return layouts.findByIdForUpdate(islandId).orElseThrow().bump(clock.instant());
    }
}
