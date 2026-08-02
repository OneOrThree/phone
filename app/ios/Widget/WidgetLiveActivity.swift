//
//  WidgetLiveActivity.swift
//  Widget
//
//  Created by Taehwa Kown on 6/27/26.
//

import ActivityKit
import WidgetKit
import SwiftUI
import UIKit

// 집중 세션 Live Activity(GROMO-553) — 세션 중 허용앱을 쓰는 동안
// 다이나믹 아일랜드/잠금화면에 집중 타이머 + 캐릭터를 표시한다.
// ⚠️ GromoFocusAttributes는 메인 앱(ios/gromo/ScreenTimeModule.swift 하단)에도
//    같은 이름·필드로 정의돼 있다 — 반드시 함께 수정할 것(타입명·인코딩으로 매칭됨).
struct GromoFocusAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        // 타이머 기준 시각 — Text(timerInterval:)가 OS에서 자체 갱신하므로 업데이트 불필요
        var startedAt: Date
    }

    // 다른 과목의 누적 집중 시간(잠금화면 표시용) — 세션 중엔 현재 과목만 증가하므로
    // 시작 시점 스냅샷으로 고정해도 항상 정확하다.
    struct OtherSubject: Codable, Hashable {
        var name: String
        var seconds: Int
        var color: String // hex 문자열(#RRGGBB)
    }

    // 세션 과목명
    var subjectName: String
    // 현재 과목을 제외한 나머지 과목들의 누적 집중 시간
    var otherSubjects: [OtherSubject]
}

// gromo 팔레트 — theme.ts에서 자동 생성된 Shared/Palette.swift를 참조한다 (GROMO-641)
// 잠금화면 배너는 앱과 같은 라이트 톤(GROMO-868). 다이나믹 아일랜드는 시스템이
// 항상 검은 배경으로 그리므로 밝은 글자(night 톤)를 유지해야 한다.
private let laBg = Palette.paper
private let laInk = Palette.ink
private let laSub = Palette.inkSub
private let laChipBg = Palette.chipBg
private let laChipBorder = Palette.chipBorder
private let laAccent = Palette.accent
private let diCream = Palette.night.cream
private let diMuted = Palette.night.muted
private let diGold = Palette.night.gold

// App Group 공유 컨테이너 ID — 실드/메인 앱과 동일하게 focusCharacter.png를 여기서 읽는다.
private let appGroupId = "group.com.oneorthree.gromo"

// 투명 여백 잘라내기(GROMO-1081) — 알파 바운딩 박스로 크롭한다.
// 메인 앱은 캐릭터를 정사각 박스(CharacterImage: size×size + contain)로 캡처하므로,
// 세로로 긴 누끼 캐릭터는 스냅샷 좌우에 투명 여백이 붙은 채 저장된다. 이 여백을 남겨 두면
// 이미지 비율이 항상 1:1로 보여 프레임을 아무리 세로로 키워도 짧은 변에 갇힌다.
// 전부 투명하거나 비트맵을 못 만들면 원본을 그대로 돌려준다(표시 자체는 절대 실패하지 않게).
private func trimmingTransparentEdges(_ image: UIImage) -> UIImage {
    guard let cg = image.cgImage, cg.width > 0, cg.height > 0 else { return image }
    let w = cg.width
    let h = cg.height
    let bytesPerRow = w * 4
    var pixels = [UInt8](repeating: 0, count: bytesPerRow * h)
    let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
        guard
            let base = buffer.baseAddress,
            let ctx = CGContext(
                data: base,
                width: w,
                height: h,
                bitsPerComponent: 8,
                bytesPerRow: bytesPerRow,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            )
        else { return false }
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        return true
    }
    guard drawn else { return image }

    // 알파가 남아 있는 픽셀의 최소/최대 좌표. 임계값 8은 안티에일리어싱 잔여를 여백으로 본다.
    let threshold: UInt8 = 8
    var minX = w, minY = h, maxX = -1, maxY = -1
    for y in 0..<h {
        let row = y * bytesPerRow
        for x in 0..<w where pixels[row + x * 4 + 3] > threshold {
            if x < minX { minX = x }
            if x > maxX { maxX = x }
            if y < minY { minY = y }
            if y > maxY { maxY = y }
        }
    }
    guard maxX >= minX, maxY >= minY else { return image }

    let rect = CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1)
    guard let cropped = cg.cropping(to: rect) else { return image }
    return UIImage(cgImage: cropped, scale: image.scale, orientation: image.imageOrientation)
}

// 캐릭터 이미지 뷰 — 세션 시작 시 메인 앱이 App Group 컨테이너에 저장한 커스텀 캐릭터
// (focusCharacter.png, captureRef로 구운 투명 PNG)를 우선 사용하고, 없으면 위젯 번들 기본
// 마스코트(character.imageset, 512px 축소본)로 폴백한다.
// 파일 경로 취득은 실드(ShieldConfigurationExtension.focusShield)의 읽기 방식을 그대로 따른다.
//
// GROMO-1081: 프레임을 size×size 정사각으로 고정하면 세로로 긴 컷아웃이 짧은 변까지 줄어든다.
// 여백을 잘라 실제 비율을 되찾은 뒤 (maxWidth × maxHeight) 박스에 비율 그대로 맞춘다.
// 프레임을 '맞춘 결과 크기'로 확정하기 때문에, 가로로 긴 캐릭터가 세로 공간을 낭비하거나
// 세로로 긴 캐릭터가 옆 텍스트를 밀어내는 일이 없다.
private struct CharacterView: View {
    let maxWidth: CGFloat
    let maxHeight: CGFloat

    // App Group 컨테이너의 커스텀 캐릭터 스냅샷(있으면). 매 렌더마다 읽고 여백을 자르지만
    // 256px 이하 이미지라 비용이 미미하고 Live Activity 렌더 빈도도 낮다
    // (실드도 표시 때마다 같은 파일을 읽는다).
    private var snapshot: UIImage? {
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupId
        ) else { return nil }
        let path = container.appendingPathComponent("focusCharacter.png").path
        guard let image = UIImage(contentsOfFile: path) else { return nil }
        return trimmingTransparentEdges(image)
    }

    // 비율 유지로 (maxWidth × maxHeight)에 맞춘 실제 표시 크기.
    private func fitted(_ source: CGSize) -> CGSize {
        guard source.width > 0, source.height > 0 else {
            let side = min(maxWidth, maxHeight)
            return CGSize(width: side, height: side)
        }
        let ratio = min(maxWidth / source.width, maxHeight / source.height)
        return CGSize(width: source.width * ratio, height: source.height * ratio)
    }

    var body: some View {
        // 기본 마스코트는 이미 여백이 트림된 에셋이라 그대로 쓴다(크기만 읽어 비율을 맞춘다).
        let image = snapshot ?? UIImage(named: "character")
        let box = fitted(image?.size ?? CGSize(width: 1, height: 1))
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
            } else {
                Image("character")
                    .resizable()
                    .scaledToFit()
            }
        }
        .frame(width: box.width, height: box.height)
    }
}

// 초 → "00:00:00" — 잠금화면 다른 과목 시간 표시용(앱의 hms 포맷과 동일)
private func hmsString(_ seconds: Int) -> String {
    let s = max(0, seconds)
    return String(format: "%02d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
}

// "#RRGGBB" hex → Color (파싱 실패 시 앱 포인트색)
private func colorFromHex(_ hex: String) -> Color {
    var s = hex.trimmingCharacters(in: .whitespaces)
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6, let v = UInt64(s, radix: 16) else { return laAccent }
    return Color(
        red: Double((v >> 16) & 0xFF) / 255,
        green: Double((v >> 8) & 0xFF) / 255,
        blue: Double(v & 0xFF) / 255
    )
}

// 경과 타이머 — OS가 매초 자체 갱신(앱 suspend와 무관)
// color: 잠금화면(라이트 배경)은 ink, 다이나믹 아일랜드(검은 배경)는 cream
private struct ElapsedTimerText: View {
    let startedAt: Date
    var font: Font = .title2
    var color: Color = diCream

    var body: some View {
        Text(timerInterval: startedAt...Date.distantFuture, countsDown: false)
            .font(font.weight(.bold).monospacedDigit())
            .foregroundStyle(color)
            .multilineTextAlignment(.trailing)
    }
}

struct WidgetLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: GromoFocusAttributes.self) { context in
            // 잠금화면/배너 UI — 현재 과목 타이머 + 다른 과목들의 누적 집중 시간.
            // ⚠️ 잠금화면 높이 상한 160pt — 넘치면 OS가 위를 잘라 캐릭터 머리가 잘린다(GROMO-868).
            // GROMO-1081: 캐릭터를 위쪽 한 줄 안(52pt)에 가두면 배너 높이의 1/3밖에 못 써서
            //    세로로 긴 컷아웃이 과하게 작아진다. 캐릭터를 배너 전체를 감싸는 바깥 HStack으로
            //    빼서 '오른쪽 열(과목·타이머 + 칩)' 높이만큼 쓰게 하되, 상한 자체는 지킨다.
            //    높이 합산 = 세로 패딩 24 + max(캐릭터 ≤96, 오른쪽 열 ≈120) = 최대 ~144pt.
            //    캐릭터 maxHeight나 칩 개수를 올릴 땐 이 합을 반드시 다시 계산할 것.
            HStack(spacing: 12) {
                CharacterView(maxWidth: 64, maxHeight: 96)
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(context.attributes.subjectName)
                                .font(.headline.weight(.bold))
                                .foregroundStyle(laInk)
                                .lineLimit(1)
                            Text("집중하는 중이에요!")
                                .font(.footnote)
                                .foregroundStyle(laSub)
                        }
                        Spacer()
                        ElapsedTimerText(startedAt: context.state.startedAt, color: laInk)
                            .frame(maxWidth: 100)
                    }
                    // 다른 과목 누적 시간 — 세션 중 불변이라 정적 표시로도 정확.
                    // 한국어 과목명이 길어 반폭 칩에선 시간이 줄바꿈됨 → 한 줄 1과목 풀폭 칩,
                    // 시간은 오른쪽 정렬 + 줄바꿈 금지. 현재 과목 외 최대 2개(높이 상한 대응).
                    if !context.attributes.otherSubjects.isEmpty {
                        VStack(spacing: 6) {
                            ForEach(Array(context.attributes.otherSubjects.prefix(2)), id: \.self) { sub in
                                HStack(spacing: 7) {
                                    Circle()
                                        .fill(colorFromHex(sub.color))
                                        .frame(width: 8, height: 8)
                                    Text(sub.name)
                                        .font(.subheadline)
                                        .foregroundStyle(laSub)
                                        .lineLimit(1)
                                    Spacer(minLength: 8)
                                    Text(hmsString(sub.seconds))
                                        .font(.subheadline.weight(.semibold).monospacedDigit())
                                        .foregroundStyle(laInk)
                                        .lineLimit(1)
                                        .fixedSize()
                                }
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(
                                    RoundedRectangle(cornerRadius: 10)
                                        .fill(laChipBg)
                                )
                                .overlay(
                                    RoundedRectangle(cornerRadius: 10)
                                        .strokeBorder(laChipBorder, lineWidth: 1)
                                )
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .activityBackgroundTint(laBg)
            .activitySystemActionForegroundColor(laInk)

        } dynamicIsland: { context in
            // 다이나믹 아일랜드 — 캐릭터 + 과목명 + 경과 타이머
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    // 펼친 상태는 세로 여유가 있어 잠금화면보다 조금 더 크게 잡는다.
                    CharacterView(maxWidth: 52, maxHeight: 76)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ElapsedTimerText(startedAt: context.state.startedAt)
                        .frame(maxWidth: 100)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(context.attributes.subjectName)
                        .font(.caption)
                        .foregroundStyle(diMuted)
                }
            } compactLeading: {
                // 컴팩트는 시스템이 주는 높이(≈26pt)가 곧 상한이라 세로는 더 못 키운다.
                // 대신 가로만 34pt까지 열어 가로로 긴 캐릭터가 과하게 줄지 않게 한다
                // (옆 타이머를 밀지 않도록 상한은 유지).
                CharacterView(maxWidth: 34, maxHeight: 26)
            } compactTrailing: {
                ElapsedTimerText(startedAt: context.state.startedAt, font: .caption2)
                    .frame(maxWidth: 60)
            } minimal: {
                // 미니멀은 원형 마스크라 정사각 박스를 그대로 둔다.
                CharacterView(maxWidth: 26, maxHeight: 26)
            }
            .keylineTint(diGold)
        }
    }
}

// #Preview(활동 프리뷰 매크로)는 iOS 18 SDK 전용이라 배포 타깃(17.0) 컴파일을 위해 제거.
