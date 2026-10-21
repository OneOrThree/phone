package com.oneorthree.phone.appearance.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.UUID;

/**
 * 옛 바다 집중 누적 (GROMO-2274, V117) — <b>더 쓰지 않는다</b>. 누적·단계표 보상 엔진은 GROMO-2301 의 세션 단위 꾸미기
 * 보상으로 바뀌며 지웠다. 표는 되돌릴 수 없어 DROP 을 별도로 미뤘고, 남아 있는 동안 지난 개인 누적을 계정 탈퇴가
 * 지울 수 있게 이 매핑만 둔다 — Flyway 없이 엔티티로 스키마를 만드는 CI 프로필에도 표가 있어야 탈퇴의 삭제가 돈다.
 * 표를 DROP 할 때 이 클래스와 저장소도 함께 지운다.
 */
@Entity
@Table(name = "sea_focus_totals")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SeaFocusTotal {

    @Id
    @Column(name = "user_id")
    private UUID userId;
}
