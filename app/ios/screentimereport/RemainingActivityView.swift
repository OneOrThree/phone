// RemainingActivityView.swift
// screentimereport 익스텐션
//
// 역할: HomeScreen "남은" StatBox 안에 표시되는 뷰
//       "목표 - 사용 = 남은" 시간을 계산해서 텍스트로 표시
//       (목표 시간을 못 읽었으면 "-", 다 썼으면 "실패")
//
// 디자인: app/components/theme.js의 statValue / statValueFail 스타일과 맞춤
//   { fontSize: 15, fontWeight: '900', color: T.ink(#111111) | T.danger(#D9362F) }

import SwiftUI

struct RemainingActivityView: View {
    let totalActivity: ActivityReport

    var body: some View {
        let isFailed = totalActivity.goalSeconds >= 0
            && (totalActivity.goalSeconds - totalActivity.totalDuration) < 0

        let text: String = {
            if totalActivity.goalSeconds < 0 {
                return "-"
            } else if isFailed {
                return "달성 실패"
            } else {
                return formatDuration(totalActivity.goalSeconds - totalActivity.totalDuration)
            }
        }()

        Text(text)
            .font(.system(size: 15, weight: .black))
            .foregroundColor(
                isFailed
                    ? Color(red: 0xD9 / 255, green: 0x36 / 255, blue: 0x2F / 255)
                    : Color(red: 0x11 / 255, green: 0x11 / 255, blue: 0x11 / 255)
            )
            .frame(maxWidth: .infinity, alignment: .center)
    }
}

#Preview {
    RemainingActivityView(totalActivity: ActivityReport(
        totalDuration: 5040,
        apps: [],
        goalSeconds: 10800
    ))
}
