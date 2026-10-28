package com.oneorthree.gromo.screentime

import android.content.Context
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/** 종료 표식과 버전은 프로세스를 넘겨 보존한다. 과거 계정·세션의 푸시는 새 차단을 만들지 않는다. */
internal class FocusSessionState(context: Context) {
  private val prefs = context.getSharedPreferences("gromo_android_focus_v2", Context.MODE_PRIVATE)
  companion object {
    private const val MAX_FOCUS_AGE_MS = 28 * 86400000L
    private val lock = Any()
    private fun deadline(state: JSONObject): Long {
      val until = state.getLong("validUntilMs")
      // 이전 무기한 상태도 최초 집중 시각 기준으로 만료시킨다. 재시작으로 연장하지 않는다.
      return if (state.optString("phase") == "focus" && until == 0L)
        state.getLong("anchorMs") + MAX_FOCUS_AGE_MS else until
    }
    private val requests = ConcurrentHashMap<String, Promise>()
    fun await(id: String, promise: Promise) {
      requests[id] = promise
      Handler(Looper.getMainLooper()).postDelayed({ requests.remove(id)?.resolve(false) }, 5000)
    }
    fun resolve(id: String?, applied: Boolean) { if (id != null) requests.remove(id)?.resolve(applied) }
  }
  fun bind(owner: String) { synchronized(lock) {
    if (prefs.getString("owner", null) != owner) {
      check(prefs.edit().clear().putString("owner", owner).commit())
    }
  }
  }
  fun accept(state: JSONObject, remote: Boolean): Boolean { synchronized(lock) {
    val owner = state.getString("owner")
    if (prefs.getString("owner", null) != owner) return false
    val id = state.getString("sessionId")
    if (id.isBlank()) return false
    val phase = state.getString("phase")
    require(phase in setOf("focus", "rest", "ended"))
    val version = state.getLong("version")
    require(version >= 0)
    val ended = JSONArray(prefs.getString("ended", "[]")!!)
    val endedIds = (0 until ended.length()).map { ended.getString(it) }.toMutableList()
    if (id in endedIds) return false
    val previous = prefs.getString("state", null)?.let { JSONObject(it) }
    if (remote && previous?.optString("sessionId") != id) return false
    if (previous?.optString("sessionId") == id && version < previous.getLong("version")) return false
    if (phase != "ended") {
      val time = System.currentTimeMillis()
      require(state.getLong("anchorMs") in 1..(time + 60_000))
      val until = deadline(state)
      if (until <= 0L || (!remote && until <= time)) return false
      // 늦게 도착한 휴식/집중도 최신 버전이면 저장해 과거 차단을 해제한다.
      state.put("validUntilMs", until)
    }
    if (previous != null && previous.optString("sessionId") != id) endedIds.add(previous.getString("sessionId"))
    if (phase == "ended") endedIds.add(id)
    check(prefs.edit().putString("state", state.toString())
      .putString("ended", JSONArray(endedIds.distinct().takeLast(128)).toString()).commit())
    return true
  }
  }
  fun snapshot(): JSONObject? = synchronized(lock) {
    val state = prefs.getString("state", null)?.let { JSONObject(it) } ?: return@synchronized null
    if (state.optString("phase") != "ended") state.put("validUntilMs", deadline(state))
    state.takeIf { it.optString("owner") == prefs.getString("owner", null) }
  }
  fun restorableSnapshot(now: Long = System.currentTimeMillis()): JSONObject? {
    val state = snapshot() ?: return null
    val phase = state.optString("phase")
    if (phase != "focus" && phase != "rest") return null
    if (state.optLong("anchorMs") !in 1..(now + 60_000)) return null
    val deadline = state.optLong("validUntilMs", -1)
    return state.takeIf { deadline > now }
  }
  fun end() { synchronized(lock) {
    val state = prefs.getString("state", null)?.let { JSONObject(it) } ?: return
    state.put("phase", "ended")
    accept(state, false)
  }
  }
  fun clear() { synchronized(lock) { end(); prefs.edit().remove("owner").commit() }
  }
}
