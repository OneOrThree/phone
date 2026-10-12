package com.oneorthree.phone.internal.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * 망원경 목록 한 칸 (GROMO-2265, 섬 외부 계약 §5).
 *
 * <p>{@link IslandSummaryView} 를 넓히지 않고 따로 둔다 — 그쪽은 검색·발견·조회·초대가 공유하는 공개 화이트리스트라,
 * 항해 분·평균 같은 망원경 전용 필드가 그 네 경로로 새면 안 된다.
 *
 * @param intro                     한 줄 소개. 소개가 없으면 빈 문자열
 * @param membershipStatus          {@code active|pending|none} — 본인 기준
 * @param slot                      {@code joined|nearby|pinned|random}
 * @param sailingMinutes            항해 분 — {@code nearby} 는 15, 나머지는 30·60·90 중 하나
 * @param averageFocusMinutesPerDay 주민 1인당 하루 평균 집중(분, 최근 7일 스냅샷). 아직 집계 전이거나 주민이 없으면 null
 * @param full                      정원이 찼다 — 구경만 할 수 있다
 * @param arrivedBefore             본인이 이 섬에 가 본 적 있다
 * @param pinnedFrom                {@code magazine|observatory} — 직접 넣은 섬({@code slot=pinned})만 값이 있고 나머지는 null
 * @param pinnedAt                  핀을 넣은 시각 — {@code pinnedFrom} 과 함께 있거나 함께 없다
 */
public record TelescopeItemView(UUID islandId, String name, String intro, int memberCount, int maxMembers,
        boolean approvalRequired, String membershipStatus, String slot, int sailingMinutes,
        Integer averageFocusMinutesPerDay, boolean full, boolean arrivedBefore,
        String pinnedFrom, Instant pinnedAt) {
}
