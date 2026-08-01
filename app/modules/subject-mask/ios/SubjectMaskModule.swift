import ExpoModulesCore
import UIKit
import Vision
import CoreImage

// 피사체 누끼 로컬 네이티브 모듈 (오브젝트 캐릭터 스파이크).
// iOS 17+ Vision의 VNGenerateForegroundInstanceMaskRequest(사진앱 '피사체 복사'와 같은 엔진)로
// 사진에서 주 피사체만 잘라 투명 PNG로 캐시에 저장하고 그 file:// URI를 돌려준다.
//
// 그레이스풀 원칙: iOS 16 이하·시뮬레이터·피사체 미검출 등 어떤 실패에서도 throw하지 않고
// 원본 URI + cutout:false + reason 을 돌려준다. 화면은 원본 사진으로라도 캐릭터를 만든다.

// 누끼 결과 — JS로 그대로 넘어가는 Record.
struct SubjectMaskResult: Record {
  @Field var uri: String = ""
  @Field var width: Double = 0
  @Field var height: Double = 0
  @Field var cutout: Bool = false // true면 배경이 제거된 투명 PNG
  @Field var reason: String = "" // cutout이 false일 때의 사유 코드
}

private enum SubjectMaskError: Error {
  case noCGImage
  case noSubject
  case renderFailed
  case encodeFailed
  case decodeFailed
}

public class SubjectMaskModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SubjectMask")

    // 누끼 지원 여부 — iOS 17 미만이면 false. (실기기/시뮬 차이는 실제 실행에서만 드러나므로
    // 여기서는 OS 버전만 본다.)
    Function("isSupported") { () -> Bool in
      if #available(iOS 17.0, *) { return true }
      return false
    }

    // 사진 URI → 누끼 PNG URI. AsyncFunction은 기본적으로 백그라운드 큐에서 돌아 UI를 막지 않는다.
    AsyncFunction("cutout") { (uri: String) -> SubjectMaskResult in
      var result = SubjectMaskResult()
      result.uri = uri

      guard #available(iOS 17.0, *) else {
        result.reason = "ios17_required"
        return result
      }
      guard let source = SubjectMaskModule.loadNormalizedImage(uri: uri) else {
        result.reason = "load_failed"
        return result
      }
      result.width = Double(source.size.width)
      result.height = Double(source.size.height)

      do {
        let cut = try SubjectMaskModule.makeCutout(source)
        result.uri = cut.url.absoluteString
        result.width = Double(cut.size.width)
        result.height = Double(cut.size.height)
        result.cutout = true
        return result
      } catch SubjectMaskError.noSubject {
        result.reason = "no_subject"
        return result
      } catch {
        // 시뮬레이터에서는 Vision 요청 자체가 실패할 수 있다 — 원본으로 폴백.
        result.reason = "vision_failed"
        return result
      }
    }

    // 합성된 오브젝트 캐릭터(팔·다리·눈까지 구워진 투명 PNG)를 Documents에 영구 저장한다.
    // 화면에서 captureRef로 캡처한 base64 PNG를 그대로 받아 customCharacter.png 한 장으로 쓴다
    // (이전 것을 덮어써 항상 1장만 유지). 이건 인앱 캐릭터 원본이라 cutout처럼 축소하지 않는다 —
    // 작은 아바타·위젯·실드는 이 원본을 각자 크기로 축소해 쓴다.
    // cutout과 달리 실패 시 폴백하지 않고 throw한다(영구 저장은 성공/실패가 명확해야 한다).
    AsyncFunction("saveCustomCharacter") { (base64: String) -> String in
      guard let data = Data(base64Encoded: base64), UIImage(data: data) != nil else {
        throw SubjectMaskError.decodeFailed
      }
      let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      let file = dir.appendingPathComponent("customCharacter.png")
      // .atomic: 임시 파일에 쓴 뒤 원자적으로 교체 — 이전 파일을 안전하게 덮어쓴다.
      try data.write(to: file, options: .atomic)
      return file.absoluteString
    }
  }

  // MARK: - 이미지 로딩

  // URI를 읽어 방향(EXIF)을 펴고 최대 변 1600px로 줄인 UIImage를 만든다.
  // Vision은 방향 메타데이터를 그대로 따라가지 않으므로 여기서 정규화해두는 편이 안전하다.
  //
  // 축소를 UIImage 디코드 이후가 아니라 ImageIO 디코드 단계에서 한다: 48MP 사진·파노라마를
  // 원본 해상도로 풀 디코드하면 원본 버퍼 + 축소본 + Vision/PNG 버퍼가 겹쳐 메모리가 치솟고,
  // jetsam 종료는 Swift·JS의 catch로 잡을 수 없어 폴백 자체가 불가능하다.
  private static func loadNormalizedImage(uri: String, maxSide: CGFloat = 1600) -> UIImage? {
    guard let url = URL(string: uri),
      let source = CGImageSourceCreateWithURL(
        url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary)
    else {
      return nil
    }

    // ThumbnailFromImageAlways: 내장 썸네일이 있어도 원본에서 만들게 해 화질을 보장.
    // WithTransform: EXIF 방향을 픽셀에 반영 — 별도 정규화 렌더링이 필요 없어진다.
    // MaxPixelSize는 긴 변 기준이며, 원본이 이보다 작으면 확대하지 않는다.
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceShouldCacheImmediately: true,
      kCGImageSourceThumbnailMaxPixelSize: Int(maxSide),
    ]
    guard let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary),
      thumbnail.width > 0, thumbnail.height > 0
    else {
      return nil
    }
    // scale 1로 만들어 size가 곧 픽셀 크기가 되게 한다(결과 width/height를 그대로 JS로 넘김).
    return UIImage(cgImage: thumbnail, scale: 1, orientation: .up)
  }

  // MARK: - 누끼

  @available(iOS 17.0, *)
  private static func makeCutout(_ image: UIImage) throws -> (url: URL, size: CGSize) {
    guard let cgImage = image.cgImage else { throw SubjectMaskError.noCGImage }

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    let request = VNGenerateForegroundInstanceMaskRequest()
    try handler.perform([request])

    guard let observation = request.results?.first, !observation.allInstances.isEmpty else {
      throw SubjectMaskError.noSubject
    }

    // 검출된 인스턴스 전체를 하나로 합쳐 잘라낸다(croppedToInstancesExtent: 피사체 바운딩 박스로 크롭).
    let buffer = try observation.generateMaskedImage(
      ofInstances: observation.allInstances,
      from: handler,
      croppedToInstancesExtent: true
    )

    let ciImage = CIImage(cvPixelBuffer: buffer)
    let context = CIContext()
    guard let output = context.createCGImage(ciImage, from: ciImage.extent) else {
      throw SubjectMaskError.renderFailed
    }
    guard let png = UIImage(cgImage: output).pngData() else {
      throw SubjectMaskError.encodeFailed
    }

    let dir = try preparedCacheDirectory()
    let file = dir.appendingPathComponent("cutout-\(UUID().uuidString).png")
    try png.write(to: file, options: .atomic)

    return (file, CGSize(width: output.width, height: output.height))
  }

  // MARK: - 캐시

  // 누끼 PNG를 둘 캐시 디렉토리를 만들고, 그 안의 이전 결과를 지운다.
  // 화면은 항상 마지막 결과 1장만 쓰므로 '다시 선택'을 반복해도 파일이 쌓이지 않게 한다
  // (Caches는 iOS가 언젠가 비워주긴 하지만 시점을 앱이 통제할 수 없다).
  private static func preparedCacheDirectory() throws -> URL {
    let fm = FileManager.default
    let dir = fm.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("subject-mask", isDirectory: true)
    try fm.createDirectory(at: dir, withIntermediateDirectories: true)

    let stale = (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
    for file in stale {
      try? fm.removeItem(at: file)
    }
    return dir
  }
}
