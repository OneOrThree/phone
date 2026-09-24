// CompactActivityView.swift
// screentimereport 익스텐션
//
// 역할: HomeScreen "사용" StatBox 안에 표시되는 미니멀 뷰
//       오늘 총 사용 시간만 텍스트로 표시 (앱별 목록 없음)
//
// 디자인: app/components/theme.js의 statValue 스타일과 맞춤
//   { fontSize: 15, fontWeight: '900', color: T.ink }

import SwiftUI

struct CompactActivityView: View {
    let totalActivity: ActivityReport

    var body: some View {
        if totalActivity.isAvailable {
            reportContent
        } else {
            Text("사용 시간을 확인할 수 없어요")
                .font(.caption)
                .foregroundColor(Palette.inkMuted)
        }
    }

    @ViewBuilder private var reportContent: some View {
        Text(formatDuration(totalActivity.totalDuration))
            .font(.body.weight(.bold))
            .monospacedDigit()
            .foregroundColor(Palette.ink)
            .frame(maxWidth: .infinity, alignment: .center)
    }
}

#Preview {
    CompactActivityView(totalActivity: ActivityReport(
        totalDuration: 5040,
        apps: [],
        categories: [],
        goalSeconds: 10800
    ))
}
