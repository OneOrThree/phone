package com.oneorthree.catusassetcache

import java.io.File
import java.io.DataInputStream
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.io.FileOutputStream
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request

internal class CacheFailure(val errorCode: String, message: String) : Exception(message)
internal fun fail(code: String, message: String): Nothing = throw CacheFailure(code, message)

internal data class DownloadInput(
  val url: String, val jobId: String, val expectedBytes: Long,
  val expectedSha256: String, val allowedOrigins: List<String>, val timeoutMs: Long
)

internal class AssetCacheStore(
  val root: File,
  private val client: OkHttpClient = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).build()
) {
  companion object {
    const val MAX_FILE = 16L * 1024 * 1024
    const val MAX_SNAPSHOT = 2 * 1024 * 1024
    private val HASH = Regex("[a-f0-9]{64}")
    private val TOKEN = Regex("[a-zA-Z0-9_-]{1,128}")
    fun uri(file: File): String = file.toURI().toString().replaceFirst("file:/", "file:///")
    fun digest(bytes: ByteArray): String = hex(MessageDigest.getInstance("SHA-256").digest(bytes))
    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }
    fun validate(input: DownloadInput) {
      if (!TOKEN.matches(input.jobId) || !HASH.matches(input.expectedSha256) ||
        input.expectedBytes !in 0..MAX_FILE || input.timeoutMs !in 1..60000) fail("E_INPUT", "잘못된 다운로드 입력")
      val url = URI(input.url)
      if (url.rawQuery != null || url.rawFragment != null || origin(url) !in input.allowedOrigins.map { originOnly(it) }) {
        fail("E_ORIGIN", "허용되지 않은 CDN URL")
      }
    }
    private fun originOnly(value: String): String {
      val uri = URI(value)
      if (uri.rawPath !in listOf(null, "", "/") || uri.rawQuery != null || uri.rawFragment != null) fail("E_ORIGIN", "origin 형식 오류")
      return origin(uri)
    }
    private fun origin(uri: URI): String {
      if (uri.scheme != "https" || uri.host.isNullOrEmpty() || uri.rawUserInfo != null || uri.port < -1 || uri.port > 65535) {
        fail("E_ORIGIN", "HTTPS origin만 허용")
      }
      return "https://${uri.host.lowercase()}" + if (uri.port == -1 || uri.port == 443) "" else ":${uri.port}"
    }
  }

  private class Job {
    val done = CountDownLatch(1)
    @Volatile var cancelled = false
    @Volatile var timedOut = false
    @Volatile var call: Call? = null
    fun cancel() { cancelled = true; call?.cancel() }
  }
  private val jobs = ConcurrentHashMap<String, Job>()
  private val workers = Executors.newCachedThreadPool()
  private val timer = Executors.newSingleThreadScheduledExecutor()

  init {
    listOf(root, File(root, "staging"), File(root, "objects"), File(root, "indexes")).forEach {
      if (!it.isDirectory && !it.mkdirs()) fail("E_IO", "캐시 디렉터리 생성 실패")
    }
  }

  fun download(input: DownloadInput, complete: (Result<Map<String, Any>>) -> Unit) {
    try { validate(input) } catch (error: Exception) { complete(Result.failure(error)); return }
    val job = Job()
    if (jobs.putIfAbsent(input.jobId, job) != null) {
      complete(Result.failure(CacheFailure("E_BUSY", "중복 jobId"))); return
    }
    workers.execute {
      val file = File(root, "staging/${input.jobId}.partial")
      var owned = false
      val started = System.nanoTime()
      val alarm = timer.schedule({ job.timedOut = true; job.cancel() }, input.timeoutMs, TimeUnit.MILLISECONDS)
      fun checkDeadline() {
        if (job.timedOut || System.nanoTime() - started >= TimeUnit.MILLISECONDS.toNanos(input.timeoutMs)) fail("E_TIMEOUT", "다운로드 시간 초과")
        if (job.cancelled) fail("E_CANCELLED", "다운로드 취소")
      }
      val result = runCatching {
        checkDeadline()
        contained(uri(file))
        if (!file.createNewFile()) fail("E_EXISTS", "staging 파일이 이미 존재")
        owned = true
        val request = Request.Builder().url(input.url).header("Accept-Encoding", "identity").build()
        val call = client.newCall(request)
        call.timeout().timeout(input.timeoutMs, TimeUnit.MILLISECONDS)
        job.call = call
        checkDeadline()
        val hash = MessageDigest.getInstance("SHA-256")
        var count = 0L
        call.execute().use { response ->
          if (response.code != 200) fail("E_HTTP_${response.code}", "HTTP ${response.code}")
          val encoding = response.header("Content-Encoding")
          if (encoding != null && !encoding.equals("identity", true)) fail("E_ENCODING", "압축 응답 거부")
          val body = response.body ?: fail("E_HTTP", "응답 본문 없음")
          if (body.contentLength() > input.expectedBytes) fail("E_SIZE", "Content-Length 초과")
          body.byteStream().use { source ->
            FileOutputStream(file).use { target ->
              val buffer = ByteArray(8192)
              while (true) {
                val length = source.read(buffer)
                if (length == -1) break
                checkDeadline()
                // 디스크에 쓰기 전에 예약된 파일 크기를 검사한다.
                if (length.toLong() > input.expectedBytes - count) fail("E_SIZE", "파일 크기 초과")
                target.write(buffer, 0, length)
                hash.update(buffer, 0, length)
                count += length
              }
              checkDeadline()
              if (count != input.expectedBytes || hex(hash.digest()) != input.expectedSha256) fail("E_INTEGRITY", "파일 크기 또는 SHA-256 불일치")
              target.fd.sync()
            }
          }
        }
        checkDeadline()
        mapOf("uri" to uri(file), "bytes" to count, "sha256" to input.expectedSha256)
      }.recoverCatching { error ->
        val remaining = if (owned && file.exists() && !file.delete()) file.length() else 0L
        val code = if (job.timedOut) "E_TIMEOUT" else if (job.cancelled) "E_CANCELLED" else (error as? CacheFailure)?.errorCode ?: "E_IO"
        fail(code, "${error.message}; remainingBytes=$remaining")
      }
      alarm.cancel(false)
      // 취소 응답은 writer 종료와 정리가 끝난 뒤에만 반환한다.
      job.done.countDown()
      jobs.remove(input.jobId, job)
      complete(result)
    }
  }


  fun metadata(url: String, origins: List<String>, maxBytes: Long, timeoutMs: Long, etag: String?,
    complete: (Result<Map<String, Any>>) -> Unit) {
    try {
      validate(DownloadInput(url, "metadata", maxBytes, "0".repeat(64), origins, timeoutMs))
      if (maxBytes !in 1..1048576 || timeoutMs !in 1..10000 ||
        (etag != null && (etag.length > 4096 || etag.any { it == '\r' || it == '\n' }))) fail("E_INPUT", "metadata 입력 오류")
    } catch (error: Exception) { complete(Result.failure(error)); return }
    workers.execute {
      val request = Request.Builder().url(url).header("Accept-Encoding", "identity")
      if (etag != null) request.header("If-None-Match", etag)
      val call = client.newCall(request.build())
      call.timeout().timeout(timeoutMs, TimeUnit.MILLISECONDS)
      val started = System.nanoTime()
      val alarm = timer.schedule({ call.cancel() }, timeoutMs, TimeUnit.MILLISECONDS)
      fun checkDeadline() {
        if (System.nanoTime() - started >= TimeUnit.MILLISECONDS.toNanos(timeoutMs)) fail("E_TIMEOUT", "metadata 시간 초과")
      }
      val result = runCatching {
        call.execute().use { response ->
          checkDeadline()
          if (response.code in 300..399 && response.code != 304) fail("E_REDIRECT", "CDN redirect 거부")
          val result = mutableMapOf<String, Any>("status" to response.code, "text" to "")
          response.header("ETag")?.let { result["etag"] = it }
          if (response.code == 200) {
            val encoding = response.header("Content-Encoding")
            if (encoding != null && !encoding.equals("identity", true)) fail("E_ENCODING", "압축 응답 거부")
            val body = response.body ?: fail("E_HTTP", "응답 본문 없음")
            if (body.contentLength() > maxBytes) fail("E_SIZE", "metadata Content-Length 초과")
            val bytes = ByteArrayOutputStream()
            body.byteStream().use { source ->
              val buffer = ByteArray(8192)
              while (true) {
                val n = source.read(buffer)
                if (n == -1) break
                checkDeadline()
                if (n > maxBytes - bytes.size()) fail("E_SIZE", "metadata 크기 초과")
                bytes.write(buffer, 0, n)
              }
            }
            result["text"] = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
              .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes.toByteArray())).toString()
          }
          checkDeadline()
          result.toMap()
        }
      }.recoverCatching { error ->
        checkDeadline()
        throw error
      }
      alarm.cancel(false)
      complete(result)
    }
  }

  fun cancel(jobId: String, complete: (Result<Unit>) -> Unit) {
    val job = jobs[jobId]
    job?.cancel()
    workers.execute { complete(runCatching { job?.done?.await(); Unit }) }
  }

  fun shutdown() { jobs.values.forEach { it.cancel() }; workers.shutdown(); timer.shutdown() }

  private fun contained(uri: String): File {
    val parsed = URI(uri)
    if (parsed.scheme != "file" || !parsed.rawAuthority.isNullOrEmpty() || parsed.rawQuery != null || parsed.rawFragment != null) fail("E_PATH", "로컬 캐시 URI만 허용")
    val file = File(parsed).canonicalFile
    if (!file.path.startsWith(root.canonicalPath + File.separator)) fail("E_PATH", "캐시 밖 경로 거부")
    return file
  }

  fun inspect(uri: String): Map<String, Any> {
    val file = contained(uri)
    if (!file.isFile || file.length() > MAX_FILE) fail("E_SIZE", "파일 없음 또는 크기 초과")
    val hash = MessageDigest.getInstance("SHA-256")
    var count = 0L
    file.inputStream().use { source ->
      val buffer = ByteArray(8192)
      while (true) {
        val n = source.read(buffer)
        if (n == -1) break
        if (n > MAX_FILE - count) fail("E_SIZE", "파일 크기 초과")
        hash.update(buffer, 0, n); count += n
      }
    }
    return mapOf("bytes" to count, "sha256" to hex(hash.digest()))
  }

  fun inspectPng(uri: String): Map<String, Int> {
    val file = contained(uri)
    if (!file.isFile || file.length() !in 33..MAX_FILE) fail("E_SIZE", "PNG 파일 크기 오류")
    // 디코더가 대형 버퍼를 할당하기 전에 고정 길이 헤더만 읽는다.
    val header = ByteArray(33)
    DataInputStream(file.inputStream()).use { it.readFully(header) }
    val signature = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    val bytes = ByteBuffer.wrap(header)
    if (!header.copyOfRange(0, 8).contentEquals(signature) || bytes.getInt(8) != 13 ||
      !header.copyOfRange(12, 16).contentEquals(byteArrayOf(0x49, 0x48, 0x44, 0x52))) fail("E_PNG", "PNG signature 또는 IHDR 오류")
    val width = bytes.getInt(16).toLong() and 0xffffffffL
    val height = bytes.getInt(20).toLong() and 0xffffffffL
    if (width !in 1..4096 || height !in 1..4096 || width * height > 16777216) fail("E_PNG", "PNG 해상도 상한 초과")
    return mapOf("width" to width.toInt(), "height" to height.toInt())
  }

  @Synchronized fun publish(uri: String, sha256: String, extension: String): String {
    if (!HASH.matches(sha256) || extension != "png") fail("E_INPUT", "객체 이름 오류")
    val source = contained(uri)
    if (source.parentFile != File(root, "staging").canonicalFile || !source.name.endsWith(".partial")) fail("E_PATH", "staging 파일만 공개 가능")
    val jobId = source.name.removeSuffix(".partial")
    if (jobs.containsKey(jobId)) fail("E_BUSY", "다운로드 중인 파일")
    if (inspect(uri)["sha256"] != sha256) fail("E_INTEGRITY", "공개 전 SHA-256 불일치")
    val target = contained(uri(File(root, "objects/$sha256.png")))
    val existingGood = target.exists() && runCatching { inspect(uri(target))["sha256"] == sha256 }.getOrDefault(false)
    if (existingGood) {
      if (!source.delete()) fail("E_IO", "staging 삭제 실패; remainingBytes=${source.length()}")
    } else {
      FileOutputStream(source, true).use { it.fd.sync() }
      // 정상 객체는 유지한다. 손상 객체 복구 중 종료되면 staging을 다음 스캔에서 회수한다.
      if (target.exists() && !target.delete()) fail("E_IO", "손상 객체 삭제 실패")
      if (!source.renameTo(target)) fail("E_IO", "객체 이동 실패")
    }
    return uri(target)
  }

  @Synchronized fun snapshot(seq: Double, payload: String): Map<String, Any> {
    if (!seq.isFinite() || seq < 1 || seq > 9007199254740991.0 || seq != Math.floor(seq)) fail("E_INPUT", "snapshot seq 오류")
    val bytes = payload.toByteArray(Charsets.UTF_8)
    if (bytes.size > MAX_SNAPSHOT) fail("E_SIZE", "snapshot 크기 초과")
    val hash = digest(bytes)
    val file = contained(uri(File(root, "indexes/${seq.toLong()}.$hash.json")))
    if (file.createNewFile()) {
      try { FileOutputStream(file).use { it.write(bytes); it.fd.sync() } }
      catch (error: Exception) { file.delete(); throw error }
    }
    if (inspect(uri(file))["sha256"] != hash) fail("E_INTEGRITY", "snapshot 재검증 실패")
    return mapOf("uri" to uri(file), "sha256" to hash)
  }
}
