import AppKit
import AVFoundation
import CoreText

let width = 1080
let height = 1920
let fps: Int32 = 24
let duration = 23.0

let root = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : FileManager.default.currentDirectoryPath)
let outputURL = root.appendingPathComponent("app/assets/app-video/gromo-intro-23s.mp4")

func loadImage(_ relativePath: String) -> CGImage {
    let url = root.appendingPathComponent(relativePath)
    guard let image = NSImage(contentsOf: url),
          let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        fatalError("Unable to load image: \(url.path)")
    }
    return cgImage
}

let logo = loadImage("app/assets/app-icons/app-logo-room20-g.png")
let study = loadImage("app/app-dev/src/assets/character_study.png")
let happy = loadImage("app/app-dev/src/assets/character_happy.png")
let character = loadImage("app/app-dev/src/assets/character.png")
let tierBadge = loadImage("app/app-dev/src/assets/tier_image/tier3.png")

let lavender = CGColor(red: 0.55, green: 0.49, blue: 0.86, alpha: 1)
let lavenderDark = CGColor(red: 0.31, green: 0.25, blue: 0.58, alpha: 1)
let lavenderLight = CGColor(red: 0.84, green: 0.80, blue: 0.98, alpha: 1)
let cream = CGColor(red: 1.00, green: 0.97, blue: 0.91, alpha: 1)
let peach = CGColor(red: 1.00, green: 0.67, blue: 0.58, alpha: 1)
let yellow = CGColor(red: 1.00, green: 0.80, blue: 0.34, alpha: 1)
let chocolate = CGColor(red: 0.16, green: 0.10, blue: 0.09, alpha: 1)
let white = CGColor(gray: 1, alpha: 1)

let titleFont = CTFontCreateWithName("AppleSDGothicNeo-Bold" as CFString, 82, nil)
let bodyFont = CTFontCreateWithName("AppleSDGothicNeo-SemiBold" as CFString, 48, nil)
let smallFont = CTFontCreateWithName("AppleSDGothicNeo-Medium" as CFString, 34, nil)
let tinyFont = CTFontCreateWithName("AppleSDGothicNeo-Medium" as CFString, 27, nil)
let timerFont = CTFontCreateWithName("AvenirNext-Bold" as CFString, 82, nil)
let brandFont = CTFontCreateWithName("AvenirNext-Heavy" as CFString, 112, nil)

func clamp(_ x: Double, _ a: Double = 0, _ b: Double = 1) -> Double { min(max(x, a), b) }
func smooth(_ x: Double) -> Double { let v = clamp(x); return v * v * (3 - 2 * v) }
func easeOutBack(_ x: Double) -> Double {
    let v = clamp(x) - 1
    return 1 + 2.70158 * v * v * v + 1.70158 * v * v
}

func focusClock(progress: Double) -> String {
    let totalSeconds = Int((clamp(progress) * 25.0 * 60.0).rounded())
    return String(format: "%02d:%02d", totalSeconds / 60, totalSeconds % 60)
}

func usagePercent(progress: Double) -> String {
    "\(Int((clamp(progress) * 32.0).rounded()))%"
}

func studyDuration(progress: Double, targetMinutes: Int) -> String {
    let totalSeconds = Int((clamp(progress) * Double(targetMinutes * 60)).rounded())
    return String(format: "%02d:%02d:%02d", totalSeconds / 3600, (totalSeconds % 3600) / 60, totalSeconds % 60)
}

precondition(focusClock(progress: 0) == "00:00")
precondition(focusClock(progress: 0.5) == "12:30")
precondition(focusClock(progress: 1) == "25:00")
precondition(usagePercent(progress: 0) == "0%")
precondition(usagePercent(progress: 0.5) == "16%")
precondition(usagePercent(progress: 1) == "32%")
precondition(studyDuration(progress: 0.5, targetMinutes: 60) == "00:30:00")

func roundedRect(_ ctx: CGContext, _ rect: CGRect, _ radius: CGFloat, _ color: CGColor) {
    ctx.setFillColor(color)
    ctx.addPath(CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil))
    ctx.fillPath()
}

func topRect(x: CGFloat, top: CGFloat, width: CGFloat, height rectHeight: CGFloat) -> CGRect {
    CGRect(x: x, y: CGFloat(height) - top - rectHeight, width: width, height: rectHeight)
}

func roundedRectTop(_ ctx: CGContext, x: CGFloat, top: CGFloat, width: CGFloat, height rectHeight: CGFloat, radius: CGFloat, color: CGColor) {
    roundedRect(ctx, topRect(x: x, top: top, width: width, height: rectHeight), radius, color)
}

func drawGradient(_ ctx: CGContext, colors: [CGColor], start: CGPoint, end: CGPoint) {
    let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors as CFArray, locations: nil)!
    ctx.drawLinearGradient(gradient, start: start, end: end, options: [])
}

func drawImage(_ ctx: CGContext, _ image: CGImage, centerX: CGFloat, topY: CGFloat, targetWidth: CGFloat, alpha: CGFloat = 1, scale: CGFloat = 1) {
    let ratio = CGFloat(image.height) / CGFloat(image.width)
    let w = targetWidth * scale
    let h = w * ratio
    let rect = CGRect(x: centerX - w / 2, y: CGFloat(height) - topY - h, width: w, height: h)
    ctx.saveGState()
    ctx.setAlpha(alpha)
    ctx.interpolationQuality = .high
    ctx.draw(image, in: rect)
    ctx.restoreGState()
}

func drawRoundedImage(_ ctx: CGContext, _ image: CGImage, centerX: CGFloat, topY: CGFloat, targetWidth: CGFloat, radius: CGFloat, alpha: CGFloat = 1, scale: CGFloat = 1) {
    let ratio = CGFloat(image.height) / CGFloat(image.width)
    let w = targetWidth * scale
    let h = w * ratio
    let rect = CGRect(x: centerX - w / 2, y: CGFloat(height) - topY - h, width: w, height: h)
    let cropScale: CGFloat = 1.035
    let drawRect = rect.insetBy(dx: -rect.width * (cropScale - 1) / 2, dy: -rect.height * (cropScale - 1) / 2)
    ctx.saveGState()
    ctx.setAlpha(alpha)
    ctx.addPath(CGPath(roundedRect: rect, cornerWidth: radius * scale, cornerHeight: radius * scale, transform: nil))
    ctx.clip()
    ctx.interpolationQuality = .high
    ctx.draw(image, in: drawRect)
    ctx.restoreGState()
}

func lineWidth(_ text: String, font: CTFont) -> CGFloat {
    let attrs = [kCTFontAttributeName: font] as CFDictionary
    let line = CTLineCreateWithAttributedString(CFAttributedStringCreate(nil, text as CFString, attrs)!)
    return CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
}

func drawText(_ ctx: CGContext, _ text: String, font: CTFont, color: CGColor, centerX: CGFloat, topY: CGFloat, alpha: CGFloat = 1) {
    let attrs: [CFString: Any] = [kCTFontAttributeName: font, kCTForegroundColorAttributeName: color.copy(alpha: alpha)!]
    let line = CTLineCreateWithAttributedString(CFAttributedStringCreate(nil, text as CFString, attrs as CFDictionary)!)
    var ascent: CGFloat = 0
    CTLineGetTypographicBounds(line, &ascent, nil, nil)
    ctx.saveGState()
    ctx.textMatrix = .identity
    ctx.textPosition = CGPoint(x: centerX - lineWidth(text, font: font) / 2, y: CGFloat(height) - topY - ascent)
    CTLineDraw(line, ctx)
    ctx.restoreGState()
}

func drawTextCentered(_ ctx: CGContext, _ text: String, font: CTFont, color: CGColor, in rect: CGRect, alpha: CGFloat = 1) {
    let attrs: [CFString: Any] = [kCTFontAttributeName: font, kCTForegroundColorAttributeName: color.copy(alpha: alpha)!]
    let line = CTLineCreateWithAttributedString(CFAttributedStringCreate(nil, text as CFString, attrs as CFDictionary)!)
    let bounds = CTLineGetBoundsWithOptions(line, [.useGlyphPathBounds])
    ctx.saveGState()
    ctx.textMatrix = .identity
    ctx.textPosition = CGPoint(x: rect.midX - bounds.midX, y: rect.midY - bounds.midY)
    CTLineDraw(line, ctx)
    ctx.restoreGState()
}

func sceneAlpha(_ t: Double, start: Double, end: Double, fade: Double = 0.42) -> CGFloat {
    if t < start || t > end { return 0 }
    let enter = start == 0 ? 1 : smooth((t - start) / fade)
    let leave = end >= duration ? 1 : smooth((end - t) / fade)
    return CGFloat(min(enter, leave))
}

func drawBase(_ ctx: CGContext, t: Double) {
    drawGradient(ctx, colors: [cream, lavenderLight], start: CGPoint(x: 0, y: CGFloat(height)), end: CGPoint(x: CGFloat(width), y: 0))
    ctx.saveGState()
    ctx.setAlpha(0.32)
    ctx.setFillColor(peach)
    ctx.fillEllipse(in: CGRect(x: -260 + 24 * sin(t * 0.55), y: 1200, width: 700, height: 700))
    ctx.setFillColor(lavender)
    ctx.fillEllipse(in: CGRect(x: 720 + 18 * cos(t * 0.5), y: 80, width: 520, height: 520))
    ctx.restoreGState()
}

func drawScene0(_ ctx: CGContext, t: Double, alpha: CGFloat) {
    guard alpha > 0 else { return }
    let p = easeOutBack((t - 0.05) / 0.9)
    ctx.saveGState(); ctx.setAlpha(alpha)
    drawRoundedImage(ctx, logo, centerX: 540, topY: 255, targetWidth: 680, radius: 118, alpha: 1, scale: CGFloat(0.82 + 0.18 * p))
    drawText(ctx, "GROMO", font: brandFont, color: lavenderDark, centerX: 540, topY: 1045)
    drawText(ctx, "집중이 자라는 시간", font: bodyFont, color: chocolate, centerX: 540, topY: 1195)
    drawText(ctx, "집중 · 성장 · 함께", font: smallFont, color: lavenderDark, centerX: 540, topY: 1295)
    ctx.restoreGState()
}

func drawScene1(_ ctx: CGContext, t: Double, alpha: CGFloat) {
    guard alpha > 0 else { return }
    let progress = smooth((t - 3.0) / 3.15)
    ctx.saveGState(); ctx.setAlpha(alpha)
    drawText(ctx, "집중할수록,", font: titleFont, color: lavenderDark, centerX: 540, topY: 185)
    drawText(ctx, "캐릭터가 자라요", font: titleFont, color: chocolate, centerX: 540, topY: 285)
    let cx: CGFloat = 540, cy: CGFloat = 815, radius: CGFloat = 285
    ctx.setLineWidth(36); ctx.setLineCap(.round)
    ctx.setStrokeColor(white.copy(alpha: 0.7)!)
    ctx.addArc(center: CGPoint(x: cx, y: CGFloat(height) - cy), radius: radius, startAngle: 0, endAngle: .pi * 2, clockwise: false); ctx.strokePath()
    ctx.setStrokeColor(lavender)
    ctx.addArc(center: CGPoint(x: cx, y: CGFloat(height) - cy), radius: radius, startAngle: -.pi / 2, endAngle: -.pi / 2 + CGFloat(progress) * .pi * 1.72, clockwise: false); ctx.strokePath()
    drawTextCentered(ctx, focusClock(progress: progress), font: timerFont, color: lavenderDark, in: topRect(x: 320, top: 700, width: 440, height: 135))
    drawText(ctx, "오늘의 집중", font: smallFont, color: chocolate, centerX: 540, topY: 835)
    let bob = CGFloat(sin(t * 3.0) * 10)
    drawImage(ctx, study, centerX: 540, topY: 1085 + bob, targetWidth: 555)
    ctx.restoreGState()
}

func drawScene2(_ ctx: CGContext, t: Double, alpha: CGFloat) {
    guard alpha > 0 else { return }
    let progress = smooth((t - 6.3) / 3.0)
    ctx.saveGState(); ctx.setAlpha(alpha)
    drawText(ctx, "스크린타임 목표를", font: titleFont, color: lavenderDark, centerX: 540, topY: 180)
    drawText(ctx, "한눈에", font: titleFont, color: chocolate, centerX: 540, topY: 280)
    roundedRectTop(ctx, x: 160, top: 620, width: 760, height: 720, radius: 92, color: white.copy(alpha: 0.86)!)
    drawTextCentered(ctx, "오늘의 사용 시간", font: smallFont, color: chocolate, in: topRect(x: 260, top: 655, width: 560, height: 90))
    let centerTopY: CGFloat = 965
    let center = CGPoint(x: 540, y: CGFloat(height) - centerTopY)
    ctx.setLineWidth(52); ctx.setLineCap(.round)
    ctx.setStrokeColor(lavenderLight)
    ctx.addArc(center: center, radius: 180, startAngle: -.pi * 0.86, endAngle: .pi * 0.86, clockwise: false); ctx.strokePath()
    ctx.setStrokeColor(peach)
    ctx.addArc(center: center, radius: 180, startAngle: -.pi * 0.86, endAngle: -.pi * 0.86 + CGFloat(progress) * .pi * 1.72, clockwise: false); ctx.strokePath()
    drawTextCentered(ctx, usagePercent(progress: progress), font: timerFont, color: lavenderDark, in: topRect(x: 330, top: 885, width: 420, height: 150))
    drawTextCentered(ctx, "목표까지 여유 있어요", font: smallFont, color: lavenderDark, in: topRect(x: 250, top: 1190, width: 580, height: 90))
    let bounce = CGFloat(abs(sin(t * 2.4)) * 12)
    drawImage(ctx, happy, centerX: 540, topY: 1410 - bounce, targetWidth: 500)
    ctx.restoreGState()
}

func subjectRow(_ ctx: CGContext, top: CGFloat, name: String, time: String, fraction: CGFloat, color: CGColor, progress: Double) {
    let dot = topRect(x: 235, top: top + 24, width: 24, height: 24)
    ctx.setFillColor(color); ctx.fillEllipse(in: dot)
    drawTextCentered(ctx, name, font: smallFont, color: chocolate, in: topRect(x: 275, top: top, width: 210, height: 70))
    drawTextCentered(ctx, time, font: tinyFont, color: lavenderDark, in: topRect(x: 655, top: top, width: 205, height: 70))
    let track = topRect(x: 275, top: top + 78, width: 585, height: 18)
    roundedRect(ctx, track, 9, lavenderLight)
    let fillWidth = max(0, track.width * fraction * CGFloat(progress))
    if fillWidth > 0 {
        roundedRect(ctx, CGRect(x: track.minX, y: track.minY, width: fillWidth, height: track.height), 9, color)
    }
}

func drawScene3(_ ctx: CGContext, t: Double, alpha: CGFloat) {
    guard alpha > 0 else { return }
    let progress = smooth((t - 9.4) / 3.0)
    ctx.saveGState(); ctx.setAlpha(alpha)
    drawText(ctx, "과목별로 나눠서", font: titleFont, color: lavenderDark, centerX: 540, topY: 175)
    drawText(ctx, "집중 시간을 기록", font: titleFont, color: chocolate, centerX: 540, topY: 275)
    roundedRectTop(ctx, x: 155, top: 565, width: 770, height: 780, radius: 92, color: white.copy(alpha: 0.88)!)
    drawTextCentered(ctx, "오늘의 과목별 공부량", font: smallFont, color: chocolate, in: topRect(x: 250, top: 610, width: 580, height: 70))
    subjectRow(ctx, top: 715, name: "국어", time: studyDuration(progress: progress, targetMinutes: 72), fraction: 1.0, color: peach, progress: progress)
    subjectRow(ctx, top: 875, name: "수학", time: studyDuration(progress: progress, targetMinutes: 54), fraction: 0.75, color: lavender, progress: progress)
    subjectRow(ctx, top: 1035, name: "영어", time: studyDuration(progress: progress, targetMinutes: 42), fraction: 0.58, color: yellow, progress: progress)
    let ratioTrack = topRect(x: 235, top: 1210, width: 610, height: 28)
    roundedRect(ctx, ratioTrack, 14, lavenderLight)
    let totalWidth = ratioTrack.width * CGFloat(progress)
    let widths: [(CGFloat, CGColor)] = [(0.43, peach), (0.32, lavender), (0.25, yellow)]
    var cursor = ratioTrack.minX
    for (share, color) in widths {
        let segment = totalWidth * share
        if segment > 0 {
            ctx.setFillColor(color)
            ctx.fill(CGRect(x: cursor, y: ratioTrack.minY, width: segment + 1, height: ratioTrack.height))
            cursor += segment
        }
    }
    drawImage(ctx, study, centerX: 540, topY: 1400, targetWidth: 470)
    ctx.restoreGState()
}

func drawScene4(_ ctx: CGContext, t: Double, alpha: CGFloat) {
    guard alpha > 0 else { return }
    let progress = smooth((t - 12.8) / 3.0)
    ctx.saveGState(); ctx.setAlpha(alpha)
    drawText(ctx, "일·주·월 통계와", font: titleFont, color: lavenderDark, centerX: 540, topY: 175)
    drawText(ctx, "과목별 또래 비교까지", font: titleFont, color: chocolate, centerX: 540, topY: 275)
    roundedRectTop(ctx, x: 155, top: 565, width: 770, height: 790, radius: 92, color: white.copy(alpha: 0.88)!)
    let tabY: CGFloat = 620
    for (index, label) in ["일", "주", "월"].enumerated() {
        let tab = topRect(x: 315 + CGFloat(index) * 150, top: tabY, width: 120, height: 64)
        roundedRect(ctx, tab, 32, index == 1 ? lavender : lavenderLight)
        drawTextCentered(ctx, label, font: smallFont, color: index == 1 ? white : lavenderDark, in: tab)
    }
    drawTextCentered(ctx, "이번 주 총 집중시간", font: smallFont, color: chocolate, in: topRect(x: 250, top: 725, width: 580, height: 65))
    let totalMinutes = Int((402.0 * progress).rounded())
    let totalLabel = String(format: "%d시간 %02d분", totalMinutes / 60, totalMinutes % 60)
    drawTextCentered(ctx, totalLabel, font: bodyFont, color: lavenderDark, in: topRect(x: 250, top: 790, width: 580, height: 90))

    ctx.setFillColor(lavender); ctx.fillEllipse(in: topRect(x: 315, top: 908, width: 22, height: 22))
    drawTextCentered(ctx, "나", font: tinyFont, color: chocolate, in: topRect(x: 345, top: 887, width: 80, height: 64))
    ctx.setFillColor(peach); ctx.fillEllipse(in: topRect(x: 530, top: 908, width: 22, height: 22))
    drawTextCentered(ctx, "같은 과목 평균", font: tinyFont, color: chocolate, in: topRect(x: 560, top: 887, width: 215, height: 64))

    let subjects = ["국어", "수학", "영어"]
    let mine: [CGFloat] = [0.86, 0.72, 0.63]
    let peers: [CGFloat] = [0.68, 0.76, 0.52]
    for i in 0..<3 {
        let rowTop = CGFloat(980 + i * 100)
        drawTextCentered(ctx, subjects[i], font: smallFont, color: chocolate, in: topRect(x: 215, top: rowTop, width: 120, height: 72))
        let mineTrack = topRect(x: 355, top: rowTop + 7, width: 470, height: 22)
        let peerTrack = topRect(x: 355, top: rowTop + 46, width: 470, height: 22)
        roundedRect(ctx, mineTrack, 11, lavenderLight)
        roundedRect(ctx, peerTrack, 11, lavenderLight)
        let mineWidth = mineTrack.width * mine[i] * CGFloat(progress)
        let peerWidth = peerTrack.width * peers[i] * CGFloat(progress)
        if mineWidth > 0 {
            roundedRect(ctx, CGRect(x: mineTrack.minX, y: mineTrack.minY, width: mineWidth, height: mineTrack.height), 11, lavender)
        }
        if peerWidth > 0 {
            roundedRect(ctx, CGRect(x: peerTrack.minX, y: peerTrack.minY, width: peerWidth, height: peerTrack.height), 11, peach)
        }
    }
    drawTextCentered(ctx, "같은 과목을 공부한 사람보다 18% 더 집중했어요", font: tinyFont, color: lavenderDark, in: topRect(x: 190, top: 1285, width: 700, height: 55))
    drawImage(ctx, character, centerX: 540, topY: 1420, targetWidth: 420)
    ctx.restoreGState()
}

func rankCard(_ ctx: CGContext, yTop: CGFloat, rank: String, name: String, time: String, color: CGColor, alpha: CGFloat, offset: CGFloat) {
    let x: CGFloat = 145 + offset
    let card = topRect(x: x, top: yTop, width: 790, height: 145)
    roundedRect(ctx, card, 54, white.copy(alpha: 0.82)!)
    let badge = topRect(x: x + 38, top: yTop + 37.5, width: 70, height: 70)
    ctx.setFillColor(color); ctx.fillEllipse(in: badge)
    drawTextCentered(ctx, rank, font: smallFont, color: white, in: badge, alpha: alpha)
    drawTextCentered(ctx, name, font: smallFont, color: chocolate, in: topRect(x: x + 140, top: yTop + 29, width: 280, height: 88), alpha: alpha)
    drawTextCentered(ctx, time, font: smallFont, color: lavenderDark, in: topRect(x: x + 540, top: yTop + 29, width: 190, height: 88), alpha: alpha)
}

func drawScene5(_ ctx: CGContext, t: Double, alpha: CGFloat) {
    guard alpha > 0 else { return }
    let p = smooth((t - 16.2) / 1.1)
    ctx.saveGState(); ctx.setAlpha(alpha)
    drawText(ctx, "같은 목표의 사람들과", font: titleFont, color: lavenderDark, centerX: 540, topY: 175)
    drawText(ctx, "리그에서 함께 성장", font: titleFont, color: chocolate, centerX: 540, topY: 275)
    rankCard(ctx, yTop: 565, rank: "1", name: "나", time: "52분", color: yellow, alpha: alpha, offset: CGFloat((1 - p) * 120))
    rankCard(ctx, yTop: 735, rank: "2", name: "모모", time: "47분", color: lavender, alpha: alpha, offset: CGFloat((1 - p) * -120))
    rankCard(ctx, yTop: 905, rank: "3", name: "두두", time: "41분", color: peach, alpha: alpha, offset: CGFloat((1 - p) * 120))
    drawText(ctx, "이번 주 초집중 모드", font: bodyFont, color: lavenderDark, centerX: 540, topY: 1100)
    drawImage(ctx, tierBadge, centerX: 300, topY: 1260, targetWidth: 315)
    drawImage(ctx, happy, centerX: 715, topY: 1325, targetWidth: 370, scale: 0.95)
    ctx.restoreGState()
}

func drawScene6(_ ctx: CGContext, t: Double, alpha: CGFloat) {
    guard alpha > 0 else { return }
    let p = easeOutBack((t - 19.8) / 0.8)
    ctx.saveGState(); ctx.setAlpha(alpha)
    drawRoundedImage(ctx, logo, centerX: 540, topY: 300, targetWidth: 640, radius: 112, scale: CGFloat(0.86 + 0.14 * p))
    drawText(ctx, "GROMO", font: brandFont, color: lavenderDark, centerX: 540, topY: 1055)
    drawText(ctx, "오늘부터, 집중을 키워보세요", font: bodyFont, color: chocolate, centerX: 540, topY: 1200)
    let button = topRect(x: 250, top: 1360, width: 580, height: 118)
    roundedRect(ctx, button, 59, lavender)
    drawTextCentered(ctx, "지금 시작하기", font: bodyFont, color: white, in: button)
    ctx.restoreGState()
}

func drawFrame(_ ctx: CGContext, t: Double) {
    drawBase(ctx, t: t)
    drawScene0(ctx, t: t, alpha: sceneAlpha(t, start: 0, end: 3.2))
    drawScene1(ctx, t: t, alpha: sceneAlpha(t, start: 2.8, end: 6.5))
    drawScene2(ctx, t: t, alpha: sceneAlpha(t, start: 6.1, end: 9.8))
    drawScene3(ctx, t: t, alpha: sceneAlpha(t, start: 9.4, end: 13.2))
    drawScene4(ctx, t: t, alpha: sceneAlpha(t, start: 12.8, end: 16.6))
    drawScene5(ctx, t: t, alpha: sceneAlpha(t, start: 16.2, end: 20.2))
    drawScene6(ctx, t: t, alpha: sceneAlpha(t, start: 19.8, end: duration))
}

if CommandLine.arguments.count >= 4 && CommandLine.arguments[2] == "--preview-dir" {
    let previewDirectory = URL(fileURLWithPath: CommandLine.arguments[3], isDirectory: true)
    try FileManager.default.createDirectory(at: previewDirectory, withIntermediateDirectories: true)
    let samples: [(String, Double)] = [
        ("01-intro", 1.4),
        ("02-focus", 4.55),
        ("03-usage", 7.75),
        ("04-subjects", 11.2),
        ("05-stats", 14.5),
        ("06-league", 18.0),
        ("07-ending", 21.3)
    ]
    for (name, t) in samples {
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: colorSpace, bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue)!
        drawFrame(ctx, t: t)
        let image = ctx.makeImage()!
        let representation = NSBitmapImageRep(cgImage: image)
        let data = representation.representation(using: .png, properties: [:])!
        try data.write(to: previewDirectory.appendingPathComponent("\(name).png"))
    }
    print(previewDirectory.path)
    exit(0)
}

try? FileManager.default.removeItem(at: outputURL)
let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
let settings: [String: Any] = [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: 8_000_000,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel
    ]
]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false
let attributes: [String: Any] = [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height,
    kCVPixelBufferCGImageCompatibilityKey as String: true,
    kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
]
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: attributes)
guard writer.canAdd(input) else { fatalError("Unable to add writer input") }
writer.add(input)
guard writer.startWriting() else { fatalError(writer.error?.localizedDescription ?? "Unable to start writer") }
writer.startSession(atSourceTime: .zero)

let frameCount = Int(duration * Double(fps))
for frame in 0..<frameCount {
    autoreleasepool {
        while !input.isReadyForMoreMediaData { usleep(1_000) }
        guard let pool = adaptor.pixelBufferPool else { fatalError("Missing pixel buffer pool") }
        var maybeBuffer: CVPixelBuffer?
        CVPixelBufferPoolCreatePixelBuffer(nil, pool, &maybeBuffer)
        guard let buffer = maybeBuffer else { fatalError("Unable to allocate pixel buffer") }
        CVPixelBufferLockBaseAddress(buffer, [])
        let ctx = CGContext(
            data: CVPixelBufferGetBaseAddress(buffer),
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue
        )!
        let t = Double(frame) / Double(fps)
        drawFrame(ctx, t: t)
        CVPixelBufferUnlockBaseAddress(buffer, [])
        let time = CMTime(value: Int64(frame), timescale: fps)
        if !adaptor.append(buffer, withPresentationTime: time) {
            fatalError(writer.error?.localizedDescription ?? "Unable to append frame \(frame)")
        }
    }
}

input.markAsFinished()
let semaphore = DispatchSemaphore(value: 0)
writer.finishWriting { semaphore.signal() }
semaphore.wait()
guard writer.status == .completed else {
    fatalError(writer.error?.localizedDescription ?? "Writer failed")
}
print(outputURL.path)
