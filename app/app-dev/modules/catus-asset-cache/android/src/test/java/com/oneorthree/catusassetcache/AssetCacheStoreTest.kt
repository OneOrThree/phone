package com.oneorthree.catusassetcache

import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody
import okio.Buffer
import okio.BufferedSource
import okio.Source
import okio.Timeout
import okio.buffer
import org.junit.Assert.*
import org.junit.Test

class AssetCacheStoreTest {
  private fun store(body: ByteArray, length: Long = -1, encoding: String? = null, status: Int = 200, delay: Long = 0): AssetCacheStore {
    val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).addInterceptor { chain ->
      val source = object : Source {
        var position = 0
        override fun timeout() = Timeout.NONE
        override fun close() {}
        override fun read(sink: Buffer, byteCount: Long): Long {
          if (delay > 0) Thread.sleep(delay)
          if (position == body.size) return -1
          val n = minOf(65, body.size - position, byteCount.toInt())
          sink.write(body, position, n); position += n; return n.toLong()
        }
      }.buffer()
      val response = Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(status).message("fixture")
        .body(object : ResponseBody() {
          override fun contentType() = null
          override fun contentLength() = length
          override fun source(): BufferedSource = source
        })
      if (encoding != null) response.header("Content-Encoding", encoding)
      response.build()
    }.build()
    return AssetCacheStore(Files.createTempDirectory("catus-kotlin-").toFile(), client)
  }
  private fun download(store: AssetCacheStore, body: ByteArray, expected: Long = body.size.toLong(), timeout: Long = 1000, hash: String = AssetCacheStore.digest(body)): Result<Map<String, Any>> {
    val done = CountDownLatch(1)
    var result: Result<Map<String, Any>>? = null
    store.download(DownloadInput("https://cdn.example/a.png", "test", expected, hash, listOf("https://cdn.example"), timeout)) { result = it; done.countDown() }
    assertTrue(done.await(3, TimeUnit.SECONDS)); return result!!
  }
  private fun code(result: Result<Map<String, Any>>) = (result.exceptionOrNull() as? CacheFailure)?.errorCode
  private fun using(store: AssetCacheStore, block: (AssetCacheStore) -> Unit) {
    try { block(store) } finally { store.shutdown(); store.root.deleteRecursively() }
  }
  @Test fun streamingAndPublication() {
    for (n in listOf(0, 55, 56, 63, 64, 65, 119, 120, 200003)) {
      val bytes = ByteArray(n) { ((it * 31 + 7) and 255).toByte() }
      using(store(bytes)) { cache ->
        val result = download(cache, bytes).getOrThrow()
        assertTrue((result["uri"] as String).startsWith("file:///"))
        assertEquals(AssetCacheStore.digest(bytes), cache.inspect(result["uri"] as String)["sha256"])
        val objectUri = cache.publish(result["uri"] as String, result["sha256"] as String, "png")
        assertEquals(n.toLong(), cache.inspect(objectUri)["bytes"])
      }
    }
  }
  @Test fun sizeCapsEncodingAndHash() {
    val body = ByteArray(130) { 1 }
    using(store(body)) { assertEquals("E_SIZE", code(download(it, body, expected = 65))); assertEquals(0, File(it.root, "staging").list()!!.size) }
    using(store(body, length = 200)) { assertEquals("E_SIZE", code(download(it, body))) }
    using(store(body, encoding = "gzip")) { assertEquals("E_ENCODING", code(download(it, body))) }
    using(store(body)) { assertEquals("E_INTEGRITY", code(download(it, body, hash = "0".repeat(64)))) }
    using(store(body, status = 302)) { assertEquals("E_HTTP_302", code(download(it, body))) }
  }
  @Test fun nativeDeadlineAndCancellation() {
    using(store(ByteArray(130), delay = 60)) { cache ->
      assertEquals("E_TIMEOUT", code(download(cache, ByteArray(130), timeout = 20)))
      assertEquals(0, File(cache.root, "staging").list()!!.size)
    }
    using(store(ByteArray(130), delay = 60)) { cache ->
      val downloaded = CountDownLatch(1); val cancelled = CountDownLatch(1)
      var result: Result<Map<String, Any>>? = null
      cache.download(DownloadInput("https://cdn.example/a.png", "cancel", 130, AssetCacheStore.digest(ByteArray(130)), listOf("https://cdn.example"), 1000)) { result = it; downloaded.countDown() }
      cache.cancel("cancel") { cancelled.countDown() }
      assertTrue(cancelled.await(2, TimeUnit.SECONDS)); assertTrue(downloaded.await(2, TimeUnit.SECONDS))
      assertEquals("E_CANCELLED", code(result!!)); assertEquals(0, File(cache.root, "staging").list()!!.size)
    }
  }
  @Test fun snapshotAndConfinement() {
    using(store(ByteArray(0))) { cache ->
      val a = cache.snapshot(1.0, "{\"seq\":1}")
      val b = cache.snapshot(2.0, "{\"seq\":2}")
      assertNotEquals(a["uri"], b["uri"])
      assertEquals(a["sha256"], cache.inspect(a["uri"] as String)["sha256"])
      assertThrows(CacheFailure::class.java) { cache.inspect("file:///etc/passwd") }
      assertThrows(CacheFailure::class.java) { cache.snapshot(3.0, "a".repeat(AssetCacheStore.MAX_SNAPSHOT + 1)) }
      assertThrows(CacheFailure::class.java) { cache.snapshot(1.5, "{}") }
      assertThrows(CacheFailure::class.java) { cache.publish(a["uri"] as String, a["sha256"] as String, "png") }
    }
  }
  @Test fun corruptObjectReplacementAndGoodObjectReuse() {
    val body = "verified".toByteArray()
    using(store(body)) { cache ->
      fun publish(): String {
        val downloaded = download(cache, body).getOrThrow()
        return cache.publish(downloaded["uri"] as String, downloaded["sha256"] as String, "png")
      }
      val first = publish()
      val file = File(java.net.URI(first))
      file.writeText("corrupt")
      assertEquals(first, publish())
      assertEquals(AssetCacheStore.digest(body), cache.inspect(first)["sha256"])
      val modified = file.lastModified()
      assertEquals(first, publish())
      assertEquals(modified, file.lastModified())
    }
  }
  @Test fun inputSecurity() {
    for (url in listOf("http://cdn.example/a", "https://user@cdn.example/a", "https://evil.example/a", "https://cdn.example/a?token=x")) {
      assertThrows(Exception::class.java) { AssetCacheStore.validate(DownloadInput(url, "job", 0, "0".repeat(64), listOf("https://cdn.example"), 1000)) }
    }
    assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", AssetCacheStore.digest(ByteArray(0)))
  }
  @Test fun metadataCapsAndStatus() {
    fun fetch(cache: AssetCacheStore, max: Long = 16, timeout: Long = 1000): Result<Map<String, Any>> {
      val done = CountDownLatch(1); var result: Result<Map<String, Any>>? = null
      cache.metadata("https://cdn.example/channel.json", listOf("https://cdn.example"), max, timeout, "\"v1\"") { result = it; done.countDown() }
      assertTrue(done.await(3, TimeUnit.SECONDS)); return result!!
    }
    using(store("{}".toByteArray())) { assertEquals("{}", fetch(it).getOrThrow()["text"]) }
    using(store(ByteArray(130))) { assertEquals("E_SIZE", code(fetch(it))) }
    using(store(ByteArray(0), length = 30)) { assertEquals("E_SIZE", code(fetch(it))) }
    using(store(ByteArray(0), status = 304)) { assertEquals(304, fetch(it).getOrThrow()["status"]) }
    using(store(ByteArray(0), status = 503)) { assertEquals(503, fetch(it).getOrThrow()["status"]) }
    using(store(ByteArray(0), status = 302)) { assertEquals("E_REDIRECT", code(fetch(it))) }
    using(store(ByteArray(0), delay = 60)) { assertEquals("E_TIMEOUT", code(fetch(it, timeout = 20))) }
  }
}
