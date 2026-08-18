package com.oneorthree.phone.league.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * 활성 유저의 주간 집중 시간 기반 전역 랭킹 조회 행.
 *
 * <p>{@code tierLevel} 은 조회 시점 스냅샷 — 랭킹/알림 표시용이다. 정산({@code LeagueUserSettler})은
 * 이 스냅샷이 락 대기 중의 커밋을 놓칠 수 있어 tierLevel 을 쓰지 않고, 락으로 잡은 유저 행을
 * 정본으로 다시 읽는다 (GROMO-1239).
 *
 * <p>{@code liveStartedAt} 은 정렬에 실제로 쓴 <b>라이브 기준 시각</b>(진행 중 세션 시작, 주 시작으로
 * 클램프)이다. 순위와 화면 표시가 <b>같은 스냅샷·같은 기준점</b>을 보게 하려고 정렬 쿼리가 함께
 * 돌려준다 — 응답의 focusStartedAt 이 이 값이고, 클라가 그리는 base + (now − 이 값) 이 곧 정렬 점수다.
 * 라이브 앵커가 필요 없는 조회(정산·알림·keyset 페이지)는 4-인자 생성자로 만들어 null 이다.
 *
 * <p>{@code liveTagName} 은 같은 세션의 태그명 — 앵커와 태그가 서로 다른 조회에서 나오면 두 조회
 * 사이에 세션을 바꾼 유저가 A 세션 경과 + B 세션 태그라는 불가능한 조합으로 응답되므로(코드리뷰
 * 반영), 태그도 정렬 쿼리의 같은 행에서 나온다. 태그 미지정 세션·미집중이면 null.
 */
public record LeagueRankingRow(
        UUID userId,
        String nickname,
        int tierLevel,
        int totalFocusSeconds,
        Instant liveStartedAt,
        String liveTagName
) {

    /** 라이브 앵커가 없는 조회(정산·알림·keyset 페이지)용 생성자. */
    public LeagueRankingRow(UUID userId, String nickname, int tierLevel, int totalFocusSeconds) {
        this(userId, nickname, tierLevel, totalFocusSeconds, null, null);
    }
}
