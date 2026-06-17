// TotalActivityView.swift
// screentimereport 익스텐션
//
// 역할: TotalActivityReport.swift에서 가공한 ActivityReport 데이터를
//       실제 화면 UI로 그려주는 SwiftUI 뷰
//
// 표시 내용:
//   - 오늘 총 사용 시간
//   - 앱별 사용 시간 목록 (많이 쓴 순서)

import SwiftUI

struct TotalActivityView: View {
    // TotalActivityReport의 makeConfiguration()이 만든 데이터를 받음
    let totalActivity: ActivityReport

    var body: some View {
        List {
            // 상단: 오늘 총 사용 시간
            Section {
                HStack {
                    Text("총 사용 시간")
                        .fontWeight(.medium)
                    Spacer()
                    Text(formatDuration(totalActivity.totalDuration))
                        .fontWeight(.semibold)
                        .foregroundColor(.blue)
                }
            }

            // 중단: 카테고리별 사용 시간 목록
            if !totalActivity.categories.isEmpty {
                Section("카테고리별 사용 시간") {
                    ForEach(totalActivity.categories) { category in
                        HStack {
                            Text(category.name)
                            Spacer()
                            Text(formatDuration(category.duration))
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }

            // 하단: 앱별 사용 시간 목록
            Section("앱별 사용 시간") {
                ForEach(totalActivity.apps) { app in
                    HStack {
                        Text(app.name)
                        Spacer()
                        Text(formatDuration(app.duration))
                            .foregroundColor(.secondary)
                    }
                }
            }
        }
    }
}

#Preview {
    TotalActivityView(totalActivity: ActivityReport(
        totalDuration: 5040,
        apps: [
            AppUsage(name: "카카오톡", duration: 3600),
            AppUsage(name: "유튜브", duration: 1200),
            AppUsage(name: "인스타그램", duration: 240)
        ],
        categories: [
            CategoryUsage(name: "소셜", duration: 3840),
            CategoryUsage(name: "엔터테인먼트", duration: 1200)
        ],
        goalSeconds: 10800
    ))
}
