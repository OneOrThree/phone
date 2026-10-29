import Foundation
import CryptoKit

struct CacheFailure: Error {
  let code: String
  let message: String
}
func cacheFail(_ code: String, _ message: String) -> CacheFailure {
  CacheFailure(code: code, message: message)
}
struct DownloadInput {
  let url: String
  let jobId: String
  let expectedBytes: Int64
  let expectedSha256: String
  let allowedOrigins: [String]
  let timeoutMs: Int
}

final class AssetCacheStore {
  static let maxFile: Int64 = 16 * 1024 * 1024
  static let maxSnapshot = 2 * 1024 * 1024
  let root: URL
  private let lock = NSLock()
  private var jobs: [String: BoundedDownload] = [:]
  private let fileLock = NSLock()
  private let configuration: () -> URLSessionConfiguration

  init(root: URL, configuration: @escaping () -> URLSessionConfiguration = { .ephemeral }) throws {
    self.configuration = configuration
    self.root = root.standardizedFileURL.resolvingSymlinksInPath()
    for directory in ["staging", "objects", "indexes"] {
      try Self.ensureDirectory(root: self.root, name: directory)
    }
  }
  static func ensureDirectory(root: URL, name: String) throws {
    // OS 캐시 회수 후에도 같은 인스턴스가 다시 쓸 수 있어야 한다.
    guard root.resolvingSymlinksInPath().path == root.path else { throw cacheFail("E_PATH", "캐시 root 변경 거부") }
    let directory = root.appendingPathComponent(name).resolvingSymlinksInPath()
    guard directory.path.hasPrefix(root.path + "/") else { throw cacheFail("E_PATH", "캐시 밖 디렉터리 거부") }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }
  static func validHash(_ value: String) -> Bool {
    value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
  }
  static func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
  static func validate(_ input: DownloadInput) throws -> URL {
    guard (1...128).contains(input.jobId.utf8.count), input.jobId.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 95 || $0 == 45 }),
      validHash(input.expectedSha256), input.expectedBytes >= 0, input.expectedBytes <= maxFile,
      (1...60000).contains(input.timeoutMs), let url = URL(string: input.url),
      let parts = URLComponents(url: url, resolvingAgainstBaseURL: false), parts.query == nil, parts.fragment == nil
    else { throw cacheFail("E_INPUT", "잘못된 다운로드 입력") }
    let expectedOrigin = try origin(input.url, originOnly: false)
    guard try input.allowedOrigins.map({ try origin($0, originOnly: true) }).contains(expectedOrigin)
    else { throw cacheFail("E_ORIGIN", "허용되지 않은 CDN URL") }
    return url
  }
  private static func origin(_ value: String, originOnly: Bool) throws -> String {
    guard let parts = URLComponents(string: value), parts.scheme == "https", let host = parts.host,
      !host.isEmpty, parts.user == nil, parts.password == nil,
      parts.port == nil || (1...65535).contains(parts.port!),
      !originOnly || ((parts.path.isEmpty || parts.path == "/") && parts.query == nil && parts.fragment == nil)
    else { throw cacheFail("E_ORIGIN", "HTTPS origin만 허용") }
    return "https://\(host.lowercased())" + ((parts.port == nil || parts.port == 443) ? "" : ":\(parts.port!)")
  }

  func download(_ input: DownloadInput, metadata: Bool = false, etag: String? = nil, complete: @escaping (Result<[String: Any], Error>) -> Void) {
    do {
      let url = try Self.validate(input)
      lock.lock()
      guard jobs[input.jobId] == nil else { lock.unlock(); throw cacheFail("E_BUSY", "중복 jobId") }
      let candidate = root.appendingPathComponent("staging/\(input.jobId).partial")
      let file: URL
      do { file = try contained(candidate.absoluteString) } catch { lock.unlock(); throw error }
      let job = BoundedDownload(input: input, url: url, file: file, configuration: configuration, metadata: metadata, etag: etag) { [weak self] result in
        guard let self else { complete(result); return }
        self.lock.lock()
        let finished = self.jobs.removeValue(forKey: input.jobId)
        self.lock.unlock()
        // 파일 핸들을 닫고 정리한 뒤에 취소 대기자와 다운로드를 완료한다.
        finished?.finishCancellation()
        complete(result)
      }
      jobs[input.jobId] = job
      lock.unlock()
      job.start()
    } catch { complete(.failure(error)) }
  }
  func metadata(url: String, origins: [String], maxBytes: Int64, timeoutMs: Int, etag: String?,
                complete: @escaping (Result<[String: Any], Error>) -> Void) {
    guard (1...1048576).contains(maxBytes), (1...10000).contains(timeoutMs),
      etag == nil || (etag!.utf8.count <= 4096 && !etag!.contains("\r") && !etag!.contains("\n"))
    else { complete(.failure(cacheFail("E_INPUT", "metadata 입력 오류"))); return }
    download(DownloadInput(url: url, jobId: UUID().uuidString, expectedBytes: maxBytes,
      expectedSha256: String(repeating: "0", count: 64), allowedOrigins: origins, timeoutMs: timeoutMs),
      metadata: true, etag: etag, complete: complete)
  }
  func cancel(_ jobId: String, complete: @escaping () -> Void) {
    lock.lock()
    let job = jobs[jobId]
    lock.unlock()
    if let job { job.cancel(complete: complete) } else { complete() }
  }
  func shutdown() {
    lock.lock(); let active = Array(jobs.values); lock.unlock()
    active.forEach { $0.cancel(complete: {}) }
  }
  private func contained(_ uri: String) throws -> URL {
    guard root.resolvingSymlinksInPath().path == root.path else { throw cacheFail("E_PATH", "캐시 root 변경 거부") }
    guard let url = URL(string: uri), url.isFileURL, url.host == nil || url.host == "",
      url.query == nil, url.fragment == nil else { throw cacheFail("E_PATH", "로컬 캐시 URI만 허용") }
    let canonical = url.standardizedFileURL.resolvingSymlinksInPath()
    guard canonical.path.hasPrefix(root.path + "/") else { throw cacheFail("E_PATH", "캐시 밖 경로 거부") }
    return canonical
  }
  func inspect(_ uri: String) throws -> [String: Any] {
    let file = try contained(uri)
    let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
    guard attributes[.type] as? FileAttributeType == .typeRegular,
      let size = attributes[.size] as? NSNumber, size.int64Value <= Self.maxFile
    else { throw cacheFail("E_SIZE", "파일 크기 초과") }
    let handle = try FileHandle(forReadingFrom: file)
    defer { try? handle.close() }
    var digest = SHA256()
    var count: Int64 = 0
    while let data = try handle.read(upToCount: 8192), !data.isEmpty {
      guard data.count <= Self.maxFile - count else { throw cacheFail("E_SIZE", "파일 크기 초과") }
      digest.update(data: data); count += Int64(data.count)
    }
    return ["bytes": count, "sha256": digest.finalize().map { String(format: "%02x", $0) }.joined()]
  }
  func inspectPng(_ uri: String) throws -> [String: Int] {
    let file = try contained(uri)
    let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
    guard attributes[.type] as? FileAttributeType == .typeRegular,
      let size = attributes[.size] as? NSNumber, (33...Self.maxFile).contains(size.int64Value)
    else { throw cacheFail("E_SIZE", "PNG 파일 크기 오류") }
    let handle = try FileHandle(forReadingFrom: file)
    defer { try? handle.close() }
    // 디코더가 대형 버퍼를 할당하기 전에 고정 길이 헤더만 읽는다.
    var header = Data()
    while header.count < 33 {
      guard let part = try handle.read(upToCount: 33 - header.count), !part.isEmpty else { throw cacheFail("E_PNG", "잘린 PNG 헤더") }
      header.append(part)
    }
    func uint32(_ offset: Int) -> UInt64 {
      header[offset..<(offset + 4)].reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
    }
    guard Array(header[0..<8]) == [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      uint32(8) == 13, Array(header[12..<16]) == [0x49, 0x48, 0x44, 0x52]
    else { throw cacheFail("E_PNG", "PNG signature 또는 IHDR 오류") }
    let width = uint32(16), height = uint32(20)
    guard (1...4096).contains(width), (1...4096).contains(height), width * height <= 16777216
    else { throw cacheFail("E_PNG", "PNG 해상도 상한 초과") }
    return ["width": Int(width), "height": Int(height)]
  }
  func publish(uri: String, sha256: String, ext: String) throws -> String {
    fileLock.lock(); defer { fileLock.unlock() }
    guard Self.validHash(sha256), ext == "png" else { throw cacheFail("E_INPUT", "객체 이름 오류") }
    let source = try contained(uri)
    guard source.deletingLastPathComponent().path == root.appendingPathComponent("staging").path,
      source.lastPathComponent.hasSuffix(".partial") else { throw cacheFail("E_PATH", "staging 파일만 공개 가능") }
    lock.lock(); let active = jobs[source.deletingPathExtension().lastPathComponent] != nil; lock.unlock()
    guard !active else { throw cacheFail("E_BUSY", "다운로드 중인 파일") }
    guard try inspect(uri)["sha256"] as? String == sha256 else { throw cacheFail("E_INTEGRITY", "공개 전 SHA-256 불일치") }
    try Self.ensureDirectory(root: root, name: "objects")
    let target = try contained(root.appendingPathComponent("objects/\(sha256).png").absoluteString)
    let existingGood = (try? inspect(target.absoluteString)["sha256"] as? String) == sha256
    if existingGood {
      try FileManager.default.removeItem(at: source)
    } else {
      let handle = try FileHandle(forWritingTo: source)
      do { try handle.synchronize(); try handle.close() } catch { try? handle.close(); throw error }
      // 정상 객체는 유지한다. 손상 객체 복구 중 종료되면 staging을 다음 스캔에서 회수한다.
      if FileManager.default.fileExists(atPath: target.path) { try FileManager.default.removeItem(at: target) }
      try FileManager.default.moveItem(at: source, to: target)
    }
    return target.absoluteString
  }
  func snapshot(seq: Double, payload: String) throws -> [String: Any] {
    fileLock.lock(); defer { fileLock.unlock() }
    guard seq.isFinite, seq >= 1, seq <= 9007199254740991, seq.rounded(.down) == seq else { throw cacheFail("E_INPUT", "snapshot seq 오류") }
    let data = Data(payload.utf8)
    guard data.count <= Self.maxSnapshot else { throw cacheFail("E_SIZE", "snapshot 크기 초과") }
    let digest = Self.hash(data)
    try Self.ensureDirectory(root: root, name: "indexes")
    let file = try contained(root.appendingPathComponent("indexes/\(Int64(seq)).\(digest).json").absoluteString)
    let descriptor = open(file.path, O_WRONLY | O_CREAT | O_EXCL, S_IRUSR | S_IWUSR)
    if descriptor >= 0 {
      let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
      do { try handle.write(contentsOf: data); try handle.synchronize(); try handle.close() }
      catch { try? handle.close(); try? FileManager.default.removeItem(at: file); throw error }
    } else if errno != EEXIST { throw cacheFail("E_IO", "snapshot 생성 실패") }
    guard try inspect(file.absoluteString)["sha256"] as? String == digest else { throw cacheFail("E_INTEGRITY", "snapshot 재검증 실패") }
    return ["uri": file.absoluteString, "sha256": digest]
  }
}

private final class BoundedDownload: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  private let input: DownloadInput
  private let url: URL
  private let file: URL
  private let complete: (Result<[String: Any], Error>) -> Void
  private let stateLock = NSLock()
  private var cancellation: [() -> Void] = []
  private var finished = false
  private var cancelled = false
  private var timedOut = false
  private var task: URLSessionDataTask?
  private var session: URLSession?
  private var timer: DispatchSourceTimer?
  // 아래 writer 상태는 직렬 delegate queue에서만 접근한다.
  private var handle: FileHandle?
  private var owned = false
  private var count: Int64 = 0
  private var digest = SHA256()
  private var failure: Error?
  private var started: UInt64 = 0
  private var settled = false
  private let metadata: Bool
  private let etag: String?
  private var responseStatus: Int?
  private var responseEtag: String?
  private var memory = Data()
  private let configuration: () -> URLSessionConfiguration
  private let queue: OperationQueue = {
    let queue = OperationQueue(); queue.maxConcurrentOperationCount = 1; return queue
  }()
  init(input: DownloadInput, url: URL, file: URL, configuration: @escaping () -> URLSessionConfiguration, metadata: Bool, etag: String?, complete: @escaping (Result<[String: Any], Error>) -> Void) {
    self.input = input; self.url = url; self.file = file; self.configuration = configuration; self.metadata = metadata; self.etag = etag; self.complete = complete
  }
  func start() {
    queue.addOperation { [self] in
      do {
        started = DispatchTime.now().uptimeNanoseconds
        if !metadata {
          try AssetCacheStore.ensureDirectory(root: file.deletingLastPathComponent().deletingLastPathComponent(), name: "staging")
          let fd = open(file.path, O_WRONLY | O_CREAT | O_EXCL, S_IRUSR | S_IWUSR)
          guard fd >= 0 else { throw cacheFail("E_EXISTS", "staging 생성 실패") }
          owned = true; handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        }
        let config = configuration()
        config.urlCache = nil; config.httpCookieStorage = nil; config.urlCredentialStorage = nil
        config.timeoutIntervalForRequest = Double(input.timeoutMs) / 1000
        config.timeoutIntervalForResource = Double(input.timeoutMs) / 1000
        let session = URLSession(configuration: config, delegate: self, delegateQueue: queue)
        self.session = session
        var request = URLRequest(url: url)
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        if let etag { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
        let task = session.dataTask(with: request)
        stateLock.lock(); self.task = task; let alreadyCancelled = cancelled; stateLock.unlock()
        if alreadyCancelled { throw cacheFail("E_CANCELLED", "다운로드 취소") }
        let timer = DispatchSource.makeTimerSource(queue: .global())
        timer.schedule(deadline: .now() + .milliseconds(input.timeoutMs))
        timer.setEventHandler { [weak self] in
          guard let self else { return }
          self.stateLock.lock(); self.timedOut = true; self.cancelled = true; let task = self.task; self.stateLock.unlock()
          task?.cancel()
        }
        self.timer = timer; timer.resume(); task.resume()
      } catch { finish(error) }
    }
  }
  func cancel(complete: @escaping () -> Void) {
    stateLock.lock()
    if finished { stateLock.unlock(); complete(); return }
    cancellation.append(complete); cancelled = true; let task = task
    stateLock.unlock(); task?.cancel()
  }
  func finishCancellation() {
    stateLock.lock(); finished = true; let callbacks = cancellation; cancellation.removeAll(); stateLock.unlock()
    callbacks.forEach { $0() }
  }
  private func checkDeadline() throws {
    stateLock.lock(); let timeout = timedOut; let cancel = cancelled; stateLock.unlock()
    if timeout || DispatchTime.now().uptimeNanoseconds - started >= UInt64(input.timeoutMs) * 1_000_000 { throw cacheFail("E_TIMEOUT", "다운로드 시간 초과") }
    if cancel { throw cacheFail("E_CANCELLED", "다운로드 취소") }
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    failure = cacheFail("E_REDIRECT", "CDN redirect 거부"); completionHandler(nil)
  }
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                  completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    do {
      try checkDeadline()
      guard let response = response as? HTTPURLResponse else { throw cacheFail("E_HTTP", "HTTP 응답 필요") }
      if metadata {
        if (300...399).contains(response.statusCode) && response.statusCode != 304 { throw cacheFail("E_REDIRECT", "CDN redirect 거부") }
        responseStatus = response.statusCode
        responseEtag = response.value(forHTTPHeaderField: "ETag")
        if response.statusCode != 200 { completionHandler(.cancel); return }
      }
      guard response.statusCode == 200 else { throw cacheFail("E_HTTP_\(response.statusCode)", "HTTP \(response.statusCode)") }
      if let encoding = response.value(forHTTPHeaderField: "Content-Encoding"), encoding.lowercased() != "identity" { throw cacheFail("E_ENCODING", "압축 응답 거부") }
      guard response.expectedContentLength <= input.expectedBytes else { throw cacheFail("E_SIZE", "Content-Length 초과") }
      completionHandler(.allow)
    } catch { failure = error; completionHandler(.cancel) }
  }
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    guard failure == nil else { return }
    do {
      try checkDeadline()
      // delegate는 OS 다운로드 임시 파일을 사용하지 않고 상한 검사 후 직접 쓴다.
      guard data.count <= input.expectedBytes - count else { throw cacheFail("E_SIZE", "파일 크기 초과") }
      if metadata { memory.append(data) } else {
        try handle?.write(contentsOf: data)
        digest.update(data: data)
      }
      count += Int64(data.count)
    } catch { failure = error; dataTask.cancel() }
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) { finish(failure ?? error) }
  private func finish(_ error: Error?) {
    guard !settled else { return }; settled = true
    timer?.cancel(); timer = nil
    var finalError = error
    // 304 및 오류 status는 본문을 읽지 않고 취소하여 메모리 한도를 보존한다.
    if metadata, let status = responseStatus, status != 200, failure == nil { finalError = nil }
    var metadataResult: [String: Any] = [:]
    do {
      try checkDeadline()
      if let error = finalError { throw error }
      if metadata {
        guard let status = responseStatus, let text = String(data: memory, encoding: .utf8) else { throw cacheFail("E_ENCODING", "UTF-8 metadata 필요") }
        metadataResult = ["status": status, "text": text]
        if let responseEtag { metadataResult["etag"] = responseEtag }
      } else {
        let actualHash = digest.finalize().map { String(format: "%02x", $0) }.joined()
        guard count == input.expectedBytes, actualHash == input.expectedSha256 else { throw cacheFail("E_INTEGRITY", "파일 크기 또는 SHA-256 불일치") }
        try handle?.synchronize()
        try handle?.close(); handle = nil
      }
      try checkDeadline()
    } catch { finalError = error }
    if handle != nil { do { try handle?.close() } catch { finalError = error }; handle = nil }
    session?.invalidateAndCancel(); session = nil
    if let error = finalError {
      if owned { try? FileManager.default.removeItem(at: file) }
      let remaining = owned ? ((try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.int64Value ?? 0) : 0
      let failure = error as? CacheFailure
      complete(.failure(cacheFail(failure?.code ?? "E_IO", "\(failure?.message ?? error.localizedDescription); remainingBytes=\(remaining)")))
    } else { complete(.success(metadata ? metadataResult : ["uri": file.absoluteString, "bytes": count, "sha256": input.expectedSha256])) }
  }
}
