import ExpoModulesCore
import Foundation

struct DownloadOptions: Record {
  @Field var url: String = ""
  @Field var jobId: String = ""
  @Field var expectedBytes: Double = -1
  @Field var expectedSha256: String = ""
  @Field var allowedOrigins: [String] = []
  @Field var timeoutMs: Double = 60000
}
struct MetadataOptions: Record {
  @Field var url: String = ""
  @Field var allowedOrigins: [String] = []
  @Field var maxBytes: Double = -1
  @Field var timeoutMs: Double = 10000
  @Field var etag: String? = nil
}
struct PublishOptions: Record {
  @Field var uri: String = ""
  @Field var sha256: String = ""
  @Field var `extension`: String = ""
}
struct SnapshotOptions: Record {
  @Field var seq: Double = 0
  @Field var payload: String = ""
}

public final class CatusAssetCacheModule: Module {
  private var store: AssetCacheStore?
  private let storeLock = NSLock()
  private func cache() throws -> AssetCacheStore {
    storeLock.lock(); defer { storeLock.unlock() }
    if let store { return store }
    guard let root = appContext?.config.cacheDirectory else { throw cacheFail("E_IO", "캐시 디렉터리 없음") }
    let created = try AssetCacheStore(root: root.appendingPathComponent("image-cdn/v1", isDirectory: true))
    store = created; return created
  }
  private func reject(_ promise: Promise, _ error: Error) {
    let failure = error as? CacheFailure
    promise.reject(failure?.code ?? "E_IO", failure?.message ?? error.localizedDescription)
  }
  public func definition() -> ModuleDefinition {
    Name("CatusAssetCache")
    Constant("apiVersion") { 1 }
    Constant("rootUri") { (try? self.cache().root.absoluteString) ?? "" }
    AsyncFunction("downloadVerified") { (options: DownloadOptions, promise: Promise) in
      do {
        guard options.expectedBytes.isFinite, options.expectedBytes >= 0,
          options.expectedBytes <= Double(AssetCacheStore.maxFile), options.expectedBytes.rounded(.down) == options.expectedBytes,
          options.timeoutMs.isFinite, (1...60000).contains(options.timeoutMs), options.timeoutMs.rounded(.down) == options.timeoutMs
        else { throw cacheFail("E_INPUT", "정수 크기와 timeout 필요") }
        try self.cache().download(DownloadInput(url: options.url, jobId: options.jobId,
          expectedBytes: Int64(options.expectedBytes), expectedSha256: options.expectedSha256,
          allowedOrigins: options.allowedOrigins, timeoutMs: Int(options.timeoutMs))) { result in
          switch result { case .success(let value): promise.resolve(value); case .failure(let error): self.reject(promise, error) }
        }
      } catch { self.reject(promise, error) }
    }
    AsyncFunction("fetchMetadata") { (options: MetadataOptions, promise: Promise) in
      do {
        guard options.maxBytes.isFinite, (1...1048576).contains(options.maxBytes), options.maxBytes.rounded(.down) == options.maxBytes,
          options.timeoutMs.isFinite, (1...10000).contains(options.timeoutMs), options.timeoutMs.rounded(.down) == options.timeoutMs
        else { throw cacheFail("E_INPUT", "정수 크기와 timeout 필요") }
        try self.cache().metadata(url: options.url, origins: options.allowedOrigins,
          maxBytes: Int64(options.maxBytes), timeoutMs: Int(options.timeoutMs), etag: options.etag) { result in
          switch result { case .success(let value): promise.resolve(value); case .failure(let error): self.reject(promise, error) }
        }
      } catch { self.reject(promise, error) }
    }
    AsyncFunction("cancelDownload") { (jobId: String, promise: Promise) in
      do { try self.cache().cancel(jobId) { promise.resolve() } } catch { self.reject(promise, error) }
    }
    AsyncFunction("inspectFile") { (uri: String, promise: Promise) in
      do { promise.resolve(try self.cache().inspect(uri)) } catch { self.reject(promise, error) }
    }
    AsyncFunction("inspectPng") { (uri: String, promise: Promise) in
      do { promise.resolve(try self.cache().inspectPng(uri)) } catch { self.reject(promise, error) }
    }
    AsyncFunction("publishObject") { (options: PublishOptions, promise: Promise) in
      do { promise.resolve(try self.cache().publish(uri: options.uri, sha256: options.sha256, ext: options.extension)) }
      catch { self.reject(promise, error) }
    }
    AsyncFunction("writeSnapshot") { (options: SnapshotOptions, promise: Promise) in
      do { promise.resolve(try self.cache().snapshot(seq: options.seq, payload: options.payload)) }
      catch { self.reject(promise, error) }
    }
    OnDestroy { self.store?.shutdown() }
  }
}
