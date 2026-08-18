//
//  ImageTrim.swift
//  Shared
//
//  캐릭터 스냅샷의 투명 여백 트림 (GROMO-1081 → GROMO-1199에서 공용화)
//

import UIKit

// 투명 여백 잘라내기 — 알파 바운딩 박스로 크롭한다.
// 메인 앱은 캐릭터를 정사각 박스(CharacterImage: size×size + contain)로 캡처하므로,
// 비정사각 캐릭터(세로로 긴 누끼, 309×340인 기본 마스코트 모두)는 스냅샷 좌우/상하에
// 투명 여백이 붙은 채 저장된다. 이 여백을 남겨 두면 이미지 비율이 1:1로 보여
// 프레임을 아무리 키워도 짧은 변에 갇힌다(= 캐릭터만 작게 보인다).
// 전부 투명하거나 비트맵을 못 만들면 원본을 그대로 돌려준다(표시 자체는 절대 실패하지 않게).
//
// ⚠️ 이 파일은 ios/Shared(동기화 폴더)에 있어 메인 앱·실드·위젯·리포트 익스텐션에
//    모두 컴파일된다. 타깃별 사본을 만들지 말 것.
func trimmingTransparentEdges(_ image: UIImage) -> UIImage {
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
