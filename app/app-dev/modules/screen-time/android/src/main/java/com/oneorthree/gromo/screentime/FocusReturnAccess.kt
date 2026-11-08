package com.oneorthree.gromo.screentime

import android.content.ComponentName
import android.content.Context
import android.os.SystemClock
import android.provider.Settings

internal object FocusReturnAccess {
  val lease = FocusReturnLease { SystemClock.elapsedRealtime() }
  @Volatile var service: FocusReturnService? = null
  @Volatile var onNeedsSync: (() -> Unit)? = null
  private fun prefs(context: Context) = context.getSharedPreferences("gromo_focus_return", Context.MODE_PRIVATE)
  @Synchronized fun bind(context: Context, owner: String) {
    val prefs = prefs(context)
    if (prefs.getString("owner", null) != owner) {
      lease.reset()
      check(prefs.edit().clear().putString("owner", owner).commit())
    }
    lease.bind(owner)
  }
  @Synchronized fun consent(context: Context, owner: String, accepted: Boolean) {
    check(owner.isNotBlank() && prefs(context).getString("owner", null) == owner) { "STALE_ACCOUNT" }
    if (!accepted) lease.clear()
    check(prefs(context).edit().putBoolean("consented", accepted).commit())
  }
  fun consented(context: Context) = prefs(context).getBoolean("consented", false)
  fun configured(context: Context) = context.getSharedPreferences("gromo_screen_time", Context.MODE_PRIVATE).contains("allowedPackages")
  fun enabled(context: Context): Boolean {
    val expected = ComponentName(context, FocusReturnService::class.java)
    return Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
      ?.split(':')?.any { ComponentName.unflattenFromString(it) == expected } == true
  }
  fun ready(context: Context) = service != null && enabled(context) && consented(context) && configured(context)
  fun active(context: Context) = ready(context) && lease.active()
  fun status(context: Context, owner: String): Map<String, Boolean> {
    val same = prefs(context).getString("owner", null) == owner
    return mapOf("enabled" to enabled(context), "connected" to (service != null),
      "consented" to (same && consented(context)), "configured" to (same && configured(context)))
  }
  @Synchronized fun reset(context: Context) {
    lease.reset()
    check(prefs(context).edit().clear().commit())
  }
}
