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
  }

  // MARK: - 이미지 로딩

  // URI를 읽어 방향(EXIF)을 펴고 최대 변 1600px로 줄인 UIImage를 만든다.
  // Vision은 방향 메타데이터를 그대로 따라가지 않으므로 여기서 정규화해두는 편이 안전하다.
  private static func loadNormalizedImage(uri: String, maxSide: CGFloat = 1600) -> UIImage? {
    guard let url = URL(string: uri), let data = try? Data(contentsOf: url),
      let image = UIImage(data: data)
    else {
      return nil
    }
    let w = image.size.width
    let h = image.size.height
    guard w > 0, h > 0 else { return nil }

    let ratio = min(1, maxSide / max(w, h))
    let target = CGSize(width: (w * ratio).rounded(), height: (h * ratio).rounded())
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    format.opaque = false
    return UIGraphicsImageRenderer(size: target, format: format).image { _ in
      image.draw(in: CGRect(origin: .zero, size: target))
    }
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

    let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("subject-mask", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let file = dir.appendingPathComponent("cutout-\(UUID().uuidString).png")
    try png.write(to: file, options: .atomic)

    return (file, CGSize(width: output.width, height: output.height))
  }
}
