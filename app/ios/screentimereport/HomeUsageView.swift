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
    private let ink = Color(red: 0x2C / 255, green: 0x24 / 255, blue: 0x21 / 255)
    private let muted = Color(red: 0xA8 / 255, green: 0x9B / 255, blue: 0x89 / 255)
    private let track = Color(red: 0xEF / 255, green: 0xE7 / 255, blue: 0xDA / 255)
    private let accent = Color(red: 0xC8 / 255, green: 0x89 / 255, blue: 0x3F / 255)
    private let over = Color(red: 0xC2 / 255, green: 0x70 / 255, blue: 0x5A / 255)

    var body: some View {
        let goal = totalActivity.goalSeconds
        let hasGoal = goal > 0
        let pct: CGFloat = hasGoal ? min(CGFloat(totalActivity.totalDuration / goal), 1) : 0
        let isOver = hasGoal && totalActivity.totalDuration > goal
        let fill = isOver ? over : accent

        VStack(alignment: .leading, spacing: 7) {
            Text(formatClock(totalActivity.totalDuration))
                .font(.system(size: 22, weight: .heavy))
                .foregroundColor(ink)

            // 진행 바(flex) + 오른쪽 고정폭 목표 블록("목표"/"n시간" 2줄)
            // → 목표 블록 폭이 고정이라 공부 집중 행과 바 길이가 동일해짐.
            HStack(alignment: .center, spacing: 9) {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 3).fill(track)
                        RoundedRectangle(cornerRadius: 3)
                            .fill(fill)
                            .frame(width: max(geo.size.width * pct, pct > 0 ? 6 : 0))
                    }
                }
                .frame(height: 6)

                VStack(alignment: .center, spacing: 1) {
                    Text("목표")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(muted)
                    Text(hasGoal ? formatDuration(goal) : "-")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(muted)
                }
                .fixedSize()
                .layoutPriority(1)
            }
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
