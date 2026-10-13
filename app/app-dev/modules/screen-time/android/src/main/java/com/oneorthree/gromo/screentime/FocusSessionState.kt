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
    private val lock = Any()
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
      val until = state.getLong("validUntilMs")
      if (!(phase == "focus" && until == 0L) && until <= time) return false
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
    state.takeIf { it.optString("owner") == prefs.getString("owner", null) }
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
