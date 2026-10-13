package com.oneorthree.gromo.screentime

import android.content.Context
import org.json.JSONObject

/** 서비스 인스턴스와 무관하게 검증한 원격 상태를 먼저 보존한다. */
internal class FocusRemoteDelivery(context: Context, private val restore: (Boolean) -> Unit) {
  private val store = FocusSessionState(context)
  fun receive(payload: String) {
    if (payload.length > 8192) return
    val state = runCatching { JSONObject(payload) }.getOrNull() ?: return
    if (!runCatching { store.accept(state, true) }.getOrDefault(false)) return
    restore(store.restorableSnapshot() == null)
  }
}
