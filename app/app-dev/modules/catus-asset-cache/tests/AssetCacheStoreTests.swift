import Foundation

final class FixtureProtocol: URLProtocol {
  static var handler: ((FixtureProtocol) -> Void)?
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() { Self.handler?(self) }
  override func stopLoading() {}
  func respond(_ data: Data, length: Int? = nil, encoding: String? = nil, status: Int = 200) {
    var headers: [String: String] = [:]
    if let length { headers["Content-Length"] = String(length) }
    if let encoding { headers["Content-Encoding"] = encoding }
    client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!, cacheStoragePolicy: .notAllowed)
    for start in stride(from: 0, to: data.count, by: 65) {
      client?.urlProtocol(self, didLoad: data.subdata(in: start..<min(start + 65, data.count)))
    }
    client?.urlProtocolDidFinishLoading(self)
  }
}

@main struct Tests {
  static func main() throws {
    let base = URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent(UUID().uuidString)
    let store = try AssetCacheStore(root: base) {
      let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [FixtureProtocol.self]; return config
    }
    defer { store.shutdown(); try? FileManager.default.removeItem(at: base) }
    var passed = 0
    func check(_ condition: Bool, _ label: String) {
      precondition(condition, label); passed += 1; print("PASS \(label)")
    }
    func download(_ body: Data, expected: Int64? = nil, timeout: Int = 1000, hash: String? = nil) -> Result<[String: Any], Error> {
      let done = DispatchSemaphore(value: 0)
      var result: Result<[String: Any], Error>!
      store.download(DownloadInput(url: "https://cdn.example/assets/a.png", jobId: UUID().uuidString,
        expectedBytes: expected ?? Int64(body.count), expectedSha256: hash ?? AssetCacheStore.hash(body),
        allowedOrigins: ["https://cdn.example"], timeoutMs: timeout)) { result = $0; done.signal() }
      precondition(done.wait(timeout: .now() + 3) == .success, "다운로드 완료 deadline")
      return result
    }
    func errorCode(_ result: Result<[String: Any], Error>) -> String {
      if case .failure(let error) = result { return (error as? CacheFailure)?.code ?? "unknown" }; return "success"
    }
    check(AssetCacheStore.hash(Data()) == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "빈 SHA-256 표준 벡터")
    for n in [0, 55, 56, 63, 64, 65, 119, 120, 200003] {
      let body = Data((0..<n).map { UInt8(($0 * 31 + 7) & 255) })
      FixtureProtocol.handler = { $0.respond(body) }
      let result = try download(body).get()
      let uri = result["uri"] as! String
      check(try store.inspect(uri)["sha256"] as? String == AssetCacheStore.hash(body), "스트리밍 경계 \(n)")
      let published = try store.publish(uri: uri, sha256: result["sha256"] as! String, ext: "png")
      check(try store.inspect(published)["bytes"] as? Int64 == Int64(n), "객체 공개 \(n)")
    }
    FixtureProtocol.handler = { $0.respond(Data(repeating: 1, count: 130)) }
    check(errorCode(download(Data(repeating: 1, count: 130), expected: 65)) == "E_SIZE", "chunked 초과 거부")
    FixtureProtocol.handler = { $0.respond(Data(), length: 200) }
    check(errorCode(download(Data(), expected: 1)) == "E_SIZE", "Content-Length 초과 거부")
    FixtureProtocol.handler = { $0.respond(Data([1]), encoding: "gzip") }
    check(errorCode(download(Data([1]))) == "E_ENCODING", "압축 응답 거부")
    FixtureProtocol.handler = { $0.respond(Data([1])) }
    check(errorCode(download(Data([1]), hash: String(repeating: "0", count: 64))) == "E_INTEGRITY", "hash 불일치 거부")
    FixtureProtocol.handler = { $0.respond(Data(), status: 302) }
    check(errorCode(download(Data())) == "E_HTTP_302", "redirect 응답 거부")
    FixtureProtocol.handler = { _ in }
    check(errorCode(download(Data(), timeout: 30)) == "E_TIMEOUT", "JS와 독립 native timeout")
    let cancelDone = DispatchSemaphore(value: 0), downloadDone = DispatchSemaphore(value: 0)
    var cancelledCode = ""
    store.download(DownloadInput(url: "https://cdn.example/a.png", jobId: "cancel", expectedBytes: 0,
      expectedSha256: AssetCacheStore.hash(Data()), allowedOrigins: ["https://cdn.example"], timeoutMs: 1000)) {
      cancelledCode = errorCode($0); downloadDone.signal()
    }
    store.cancel("cancel") { cancelDone.signal() }
    check(cancelDone.wait(timeout: .now() + 2) == .success && downloadDone.wait(timeout: .now() + 2) == .success && cancelledCode == "E_CANCELLED", "취소 writer 종료 대기")
    check((try FileManager.default.contentsOfDirectory(atPath: base.appendingPathComponent("staging").path)).isEmpty, "실패 staging 정리")
    let first = try store.snapshot(seq: 1, payload: "{\"seq\":1}")
    let second = try store.snapshot(seq: 2, payload: "{\"seq\":2}")
    check(try store.inspect(first["uri"] as! String)["sha256"] as? String == first["sha256"] as? String, "이전 snapshot 보존")
    check(first["uri"] as? String != second["uri"] as? String, "고유 snapshot")
    do { _ = try store.inspect("file:///etc/passwd"); fatalError("root 이탈 허용") } catch { check(true, "root 이탈 거부") }
    do { _ = try store.snapshot(seq: 3, payload: String(repeating: "a", count: AssetCacheStore.maxSnapshot + 1)); fatalError("상한 허용") } catch { check(true, "snapshot 2MiB 상한") }
    do { _ = try AssetCacheStore.validate(DownloadInput(url: "https://user@cdn.example/a.png", jobId: "x", expectedBytes: 0, expectedSha256: AssetCacheStore.hash(Data()), allowedOrigins: ["https://cdn.example"], timeoutMs: 1)); fatalError("userinfo 허용") } catch { check(true, "userinfo 거부") }
    let replacementBody = Data("verified".utf8)
    FixtureProtocol.handler = { $0.respond(replacementBody) }
    func publishReplacement() throws -> String {
      let result = try download(replacementBody).get()
      return try store.publish(uri: result["uri"] as! String, sha256: result["sha256"] as! String, ext: "png")
    }
    let objectUri = try publishReplacement()
    try Data("corrupt".utf8).write(to: URL(string: objectUri)!)
    check(try publishReplacement() == objectUri, "손상 객체 교체")
    check(try store.inspect(objectUri)["sha256"] as? String == AssetCacheStore.hash(replacementBody), "손상 객체 정상 bytes 복구")
    let modified = try FileManager.default.attributesOfItem(atPath: URL(string: objectUri)!.path)[.modificationDate] as! Date
    check(try publishReplacement() == objectUri, "정상 객체 재사용")
    check(try FileManager.default.attributesOfItem(atPath: URL(string: objectUri)!.path)[.modificationDate] as? Date == modified, "정상 객체 덮어쓰기 없음")
    func metadata(max: Int64 = 16, timeout: Int = 1000) -> Result<[String: Any], Error> {
      let done = DispatchSemaphore(value: 0); var result: Result<[String: Any], Error>!
      store.metadata(url: "https://cdn.example/channel.json", origins: ["https://cdn.example"], maxBytes: max,
        timeoutMs: timeout, etag: "\"v1\"") { result = $0; done.signal() }
      precondition(done.wait(timeout: .now() + 3) == .success); return result
    }
    FixtureProtocol.handler = {
      precondition($0.request.value(forHTTPHeaderField: "If-None-Match") == "\"v1\"")
      $0.respond(Data("{}".utf8))
    }
    check(try metadata().get()["text"] as? String == "{}", "metadata 조건부 GET")
    FixtureProtocol.handler = { $0.respond(Data(repeating: 1, count: 130)) }
    check(errorCode(metadata()) == "E_SIZE", "metadata chunked 상한")
    FixtureProtocol.handler = { $0.respond(Data(), length: 30) }
    check(errorCode(metadata()) == "E_SIZE", "metadata Content-Length 상한")
    FixtureProtocol.handler = { $0.respond(Data(), status: 304) }
    check(try metadata().get()["status"] as? Int == 304, "metadata 304")
    FixtureProtocol.handler = { $0.respond(Data(), status: 503) }
    check(try metadata().get()["status"] as? Int == 503, "metadata HTTP 오류")
    FixtureProtocol.handler = { $0.respond(Data(), status: 302) }
    check(errorCode(metadata()) == "E_REDIRECT", "metadata redirect 거부")
    FixtureProtocol.handler = { _ in }
    check(errorCode(metadata(timeout: 30)) == "E_TIMEOUT", "metadata native timeout")
    let pngFile = base.appendingPathComponent("staging/header.partial")
    var pngHeader = Data(repeating: 0, count: 33)
    pngHeader.replaceSubrange(0..<8, with: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    func putUInt32(_ data: inout Data, _ offset: Int, _ value: UInt32) {
      for index in 0..<4 { data[offset + index] = UInt8((value >> (24 - index * 8)) & 255) }
    }
    putUInt32(&pngHeader, 8, 13); putUInt32(&pngHeader, 12, 0x49484452)
    putUInt32(&pngHeader, 16, 4096); putUInt32(&pngHeader, 20, 4096)
    try pngHeader.write(to: pngFile)
    check(try store.inspectPng(pngFile.absoluteString) == ["width": 4096, "height": 4096], "PNG 최대 허용 해상도")
    for (offset, value): (Int, UInt32) in [(0, 0), (8, 12), (12, 0), (16, 0), (16, 4097), (20, 4097), (16, UInt32.max)] {
      var corrupt = pngHeader; putUInt32(&corrupt, offset, value); try corrupt.write(to: pngFile)
      do { _ = try store.inspectPng(pngFile.absoluteString); fatalError("잘못된 PNG 헤더 허용") }
      catch { check((error as? CacheFailure)?.code == "E_PNG", "PNG signature/IHDR/해상도 거부 \(offset):\(value)") }
    }
    try pngHeader.prefix(32).write(to: pngFile)
    do { _ = try store.inspectPng(pngFile.absoluteString); fatalError("잘린 PNG 허용") }
    catch { check((error as? CacheFailure)?.code == "E_SIZE", "잘린 PNG 거부") }
    try pngHeader.write(to: pngFile)
    let oversized = try FileHandle(forWritingTo: pngFile)
    try oversized.truncate(atOffset: UInt64(AssetCacheStore.maxFile + 1)); try oversized.close()
    do { _ = try store.inspectPng(pngFile.absoluteString); fatalError("대형 PNG 허용") }
    catch { check((error as? CacheFailure)?.code == "E_SIZE", "PNG 파일 16MiB 상한") }
    do { _ = try store.inspectPng("file:///etc/passwd"); fatalError("PNG root 탈출") }
    catch { check((error as? CacheFailure)?.code == "E_PATH", "PNG root 탈출 거부") }
    FixtureProtocol.handler = { $0.respond(replacementBody) }
    try FileManager.default.removeItem(at: base)
    var restored = try download(replacementBody).get()
    check(try store.inspect(restored["uri"] as! String)["bytes"] as? Int64 == Int64(replacementBody.count), "같은 인스턴스 root 회수 후 다운로드 복구")
    _ = try store.publish(uri: restored["uri"] as! String, sha256: restored["sha256"] as! String, ext: "png")
    try FileManager.default.removeItem(at: base.appendingPathComponent("staging"))
    restored = try download(replacementBody).get()
    check(try store.inspect(restored["uri"] as! String)["sha256"] as? String == AssetCacheStore.hash(replacementBody), "staging 회수 후 다운로드 복구")
    try FileManager.default.removeItem(at: base.appendingPathComponent("objects"))
    let restoredObject = try store.publish(uri: restored["uri"] as! String, sha256: restored["sha256"] as! String, ext: "png")
    check(try store.inspect(restoredObject)["sha256"] as? String == AssetCacheStore.hash(replacementBody), "objects 회수 후 공개 복구")
    try FileManager.default.removeItem(at: base)
    var restoredSnapshot = try store.snapshot(seq: 1, payload: "{\"seq\":1}")
    check(try store.inspect(restoredSnapshot["uri"] as! String)["sha256"] as? String == restoredSnapshot["sha256"] as? String, "root 회수 후 snapshot 복구")
    try FileManager.default.removeItem(at: base.appendingPathComponent("indexes"))
    restoredSnapshot = try store.snapshot(seq: 2, payload: "{\"seq\":2}")
    check(try store.inspect(restoredSnapshot["uri"] as! String)["sha256"] as? String == restoredSnapshot["sha256"] as? String, "indexes 회수 후 snapshot 복구")
    try FileManager.default.removeItem(at: base)
    let concurrentDone = DispatchSemaphore(value: 0)
    let resultLock = NSLock()
    var successes = 0
    for job in ["parallel-a", "parallel-b"] {
      store.download(DownloadInput(url: "https://cdn.example/a.png", jobId: job, expectedBytes: Int64(replacementBody.count), expectedSha256: AssetCacheStore.hash(replacementBody), allowedOrigins: ["https://cdn.example"], timeoutMs: 1000)) { result in
        resultLock.lock(); if case .success = result { successes += 1 }; resultLock.unlock()
        concurrentDone.signal()
      }
    }
    check(concurrentDone.wait(timeout: .now() + 3) == .success && concurrentDone.wait(timeout: .now() + 3) == .success && successes == 2, "root 회수 후 동시 다운로드 mkdir 경합")
    let outside = base.deletingLastPathComponent().appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
    let indexesLink = base.appendingPathComponent("indexes")
    try FileManager.default.createSymbolicLink(at: indexesLink, withDestinationURL: outside)
    do { _ = try store.snapshot(seq: 3, payload: "{}"); fatalError("외부 디렉터리 생성 허용") }
    catch { check((error as? CacheFailure)?.code == "E_PATH", "디렉터리 재생성도 외부 symlink 거부") }
    check(try FileManager.default.contentsOfDirectory(atPath: outside.path).isEmpty, "외부 디렉터리에 쓰지 않음")
    try FileManager.default.removeItem(at: indexesLink); try FileManager.default.removeItem(at: outside)
    print("Swift native tests: \(passed) passed")
  }
}
