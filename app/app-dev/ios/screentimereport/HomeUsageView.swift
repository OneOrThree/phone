// HomeUsageView.swift
// screentimereport 익스텐션
//
// 역할: v2 홈 "핸드폰 사용" 칸 안에 그려지는 뷰 — 큰 사용시간 값 + 목표 대비 진행 바.
//   JS MetricRow(공부 집중)의 값+바 영역과 시각적으로 맞춤(v2 팔레트/사이즈).
//   목표를 못 읽었으면(goalSeconds<=0) 바는 비고 값만 표시.

import SwiftUI

struct HomeUsageView: View {
    let totalActivity: ActivityReport

    // v2 팔레트 (theme.ts와 일치)
    private let ink = Palette.ink
    private let muted = Palette.inkMuted
    private let track = Palette.track
    private let accent = Palette.accent
    private let over = Palette.accentAlt

    var body: some View {
        let goal = totalActivity.goalSeconds
        let hasGoal = goal > 0
        let pct: CGFloat = hasGoal ? min(CGFloat(totalActivity.totalDuration / goal), 1) : 0
        let isOver = hasGoal && totalActivity.totalDuration > goal
        let fill = isOver ? over : accent

        VStack(alignment: .leading, spacing: 7) {
            // 값 줄 — 왼쪽 큰 값 + 오른쪽 목표(바 옆이 아니라 값 줄로 올림, JS MetricRow와 동일)
            HStack(alignment: .lastTextBaseline, spacing: 8) {
                Text(formatClock(totalActivity.totalDuration))
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundColor(ink)
                Spacer(minLength: 0)
                Text(hasGoal ? "목표 \(formatDuration(goal))" : "목표 -")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(muted)
                    .lineLimit(1)
            }

            // 진행 바 — 카드 끝까지 전체 폭(공부 집중 행과 동일)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3).fill(track)
                    RoundedRectangle(cornerRadius: 3)
                        .fill(fill)
                        .frame(width: max(geo.size.width * pct, pct > 0 ? 6 : 0))
                }
            }
            .frame(height: 6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

#Preview {
    HomeUsageView(totalActivity: ActivityReport(
        totalDuration: 9360,
        apps: [],
        categories: [],
        goalSeconds: 16200
    ))
}
