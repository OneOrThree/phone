package com.oneorthree.catusassetcache

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File

class DownloadOptions : Record {
  @Field var url: String = ""
  @Field var jobId: String = ""
  @Field var expectedBytes: Double = -1.0
  @Field var expectedSha256: String = ""
  @Field var allowedOrigins: List<String> = emptyList()
  @Field var timeoutMs: Double = 60000.0
}
class MetadataOptions : Record {
  @Field var url: String = ""
  @Field var allowedOrigins: List<String> = emptyList()
  @Field var maxBytes: Double = -1.0
  @Field var timeoutMs: Double = 10000.0
  @Field var etag: String? = null
}
class PublishOptions : Record {
  @Field var uri: String = ""
  @Field var sha256: String = ""
  @Field var extension: String = ""
}
class SnapshotOptions : Record {
  @Field var seq: Double = 0.0
  @Field var payload: String = ""
}

class CatusAssetCacheModule : Module() {
  private val store by lazy { AssetCacheStore(File(appContext.cacheDirectory, "image-cdn/v1")) }
  private fun reject(promise: Promise, error: Throwable) {
    promise.reject((error as? CacheFailure)?.errorCode ?: "E_IO", error.message, error)
  }
  override fun definition() = ModuleDefinition {
    Name("CatusAssetCache")
    Constant("apiVersion") { 1 }
    Constant("rootUri") { AssetCacheStore.uri(store.root) }
    AsyncFunction("downloadVerified") { options: DownloadOptions, promise: Promise ->
      if (!options.expectedBytes.isFinite() || options.expectedBytes != Math.floor(options.expectedBytes) ||
        !options.timeoutMs.isFinite() || options.timeoutMs != Math.floor(options.timeoutMs)) {
        promise.reject("E_INPUT", "정수 크기와 timeout 필요", null)
      } else {
        store.download(DownloadInput(options.url, options.jobId, options.expectedBytes.toLong(),
          options.expectedSha256, options.allowedOrigins, options.timeoutMs.toLong())) { result ->
          result.fold({ promise.resolve(it) }, { reject(promise, it) })
        }
      }
    }
    AsyncFunction("fetchMetadata") { options: MetadataOptions, promise: Promise ->
      if (!options.maxBytes.isFinite() || options.maxBytes != Math.floor(options.maxBytes) ||
        !options.timeoutMs.isFinite() || options.timeoutMs != Math.floor(options.timeoutMs)) {
        promise.reject("E_INPUT", "정수 크기와 timeout 필요", null)
      } else {
        store.metadata(options.url, options.allowedOrigins, options.maxBytes.toLong(), options.timeoutMs.toLong(), options.etag) { result ->
          result.fold({ promise.resolve(it) }, { reject(promise, it) })
        }
      }
    }
    AsyncFunction("cancelDownload") { jobId: String, promise: Promise ->
      store.cancel(jobId) { result -> result.fold({ promise.resolve() }, { reject(promise, it) }) }
    }
    AsyncFunction("inspectFile") { uri: String, promise: Promise ->
      runCatching { store.inspect(uri) }.fold({ promise.resolve(it) }, { reject(promise, it) })
    }
    AsyncFunction("publishObject") { options: PublishOptions, promise: Promise ->
      runCatching { store.publish(options.uri, options.sha256, options.extension) }
        .fold({ promise.resolve(it) }, { reject(promise, it) })
    }
    AsyncFunction("writeSnapshot") { options: SnapshotOptions, promise: Promise ->
      runCatching { store.snapshot(options.seq, options.payload) }
        .fold({ promise.resolve(it) }, { reject(promise, it) })
    }
    OnDestroy { store.shutdown() }
  }
}
