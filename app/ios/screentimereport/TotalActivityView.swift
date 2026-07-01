// TotalActivityView.swift
// screentimereport 익스텐션
//
// 역할: ActivityReport(총합/카테고리별/앱별)를 v2 디자인으로 그리는 뷰.
//       홈 "핸드폰 사용" 탭 시 오버레이로 표시됨.
//       기본 List 대신 ScrollView+커스텀 카드로 v2 팔레트(페이퍼/화이트/브라운)에 맞춤.

import SwiftUI

struct TotalActivityView: View {
    let totalActivity: ActivityReport

    // v2 팔레트 (theme.ts와 일치)
    private let bg = Color(red: 0xF6 / 255, green: 0xF1 / 255, blue: 0xE9 / 255)
    private let ink = Color(red: 0x2C / 255, green: 0x24 / 255, blue: 0x21 / 255)
    private let sub = Color(red: 0x8A / 255, green: 0x7B / 255, blue: 0x68 / 255)
    private let muted = Color(red: 0xA8 / 255, green: 0x9B / 255, blue: 0x89 / 255)
    private let cardBorder = Color(red: 0xEC / 255, green: 0xE2 / 255, blue: 0xD1 / 255)
    private let divider = Color(red: 0xF0 / 255, green: 0xE9 / 255, blue: 0xDC / 255)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                // 총 사용시간 카드
                VStack(alignment: .leading, spacing: 6) {
                    Text("오늘 총 사용시간")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(sub)
                    Text(formatDuration(totalActivity.totalDuration))
                        .font(.system(size: 30, weight: .heavy))
                        .foregroundColor(ink)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(18)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 18))
                .overlay(RoundedRectangle(cornerRadius: 18).stroke(cardBorder, lineWidth: 1))

                // 카테고리별
                if !totalActivity.categories.isEmpty {
                    sectionHeader("카테고리별")
                    usageCard(rows: totalActivity.categories.map { ($0.name, $0.duration) })
                }

                // 앱별
                sectionHeader("앱별 사용시간")
                if totalActivity.apps.isEmpty {
                    Text("사용 기록이 없어요")
                        .font(.system(size: 15))
                        .foregroundColor(muted)
                        .padding(.vertical, 8)
                } else {
                    usageCard(rows: totalActivity.apps.map { ($0.name, $0.duration) })
                }
            }
            .padding(16)
        }
        .background(bg)
    }

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 15, weight: .semibold))
            .foregroundColor(sub)
    }

    // 이름 + 사용시간 행들을 화이트 카드로 묶어 그린다.
    private func usageCard(rows: [(String, TimeInterval)]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { idx, row in
                HStack {
                    Text(row.0)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(ink)
                        .lineLimit(1)
                    Spacer()
                    Text(formatDuration(row.1))
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(muted)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 13)

                if idx < rows.count - 1 {
                    Rectangle().fill(divider).frame(height: 1).padding(.leading, 16)
                }
            }
        }
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(cardBorder, lineWidth: 1))
    }
}

#Preview {
    TotalActivityView(totalActivity: ActivityReport(
        totalDuration: 22440,
        apps: [
            AppUsage(name: "카카오톡", duration: 3600),
            AppUsage(name: "유튜브", duration: 5400),
            AppUsage(name: "인스타그램", duration: 2400)
        ],
        categories: [
            CategoryUsage(name: "소셜", duration: 6000),
            CategoryUsage(name: "엔터테인먼트", duration: 5400)
        ],
        goalSeconds: 16200
    ))
}
