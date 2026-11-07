package com.oneorthree.gromo.screentime

import android.accessibilityservice.AccessibilityService
import android.app.KeyguardManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.provider.AlarmClock
import android.provider.Settings
import android.telecom.TelecomManager
import android.view.accessibility.AccessibilityEvent
import android.view.inputmethod.InputMethodManager

/** 화면 내용·입력·제스처 없이 앱의 Activity 전환만 받는다. 별도 차단 창은 만들지 않는다. */
class FocusReturnService : AccessibilityService() {
  private val handler = Handler(Looper.getMainLooper())
  private var foregroundPackage: String? = null
  private var lastReturn = -2_000L
  private var lastCheck = -5_000L
  private val evaluateTask = Runnable { evaluate() }

  override fun onServiceConnected() {
    FocusReturnAccess.service = this
    FocusReturnAccess.lease.connect(true)
    FocusReturnAccess.onNeedsSync?.invoke()
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
    // 시스템 창·홈·키보드로 이동한 뒤 늦게 온 확인 응답이 앱을 끌어오지 않게 먼저 비운다.
    foregroundPackage = null
    if (!FocusReturnAccess.ready(this)) return
    if (!FocusReturnAccess.lease.active() && !FocusReturnAccess.lease.needsConfirmation()) return
    val pkg = event.packageName?.toString() ?: return
    if (exempt(pkg)) return
    val activity = event.className?.toString() ?: return
    // Toast/Dialog 등 앱 안 작은 창은 앱 실행으로 판정하지 않는다.
    if (runCatching { packageManager.getActivityInfo(ComponentName(pkg, activity), 0) }.isFailure) return
    foregroundPackage = pkg
    evaluate()
  }

  internal fun reevaluate() { handler.removeCallbacks(evaluateTask); handler.post(evaluateTask) }

  private fun evaluate() {
    val pkg = foregroundPackage ?: return
    if (!FocusReturnAccess.ready(this) || exempt(pkg) || !interactive()) return
    val allowed = getSharedPreferences("gromo_screen_time", MODE_PRIVATE).getStringSet("allowedPackages", null) ?: return
    if (pkg in allowed) return
    val now = SystemClock.elapsedRealtime()
    if (!FocusReturnAccess.lease.active()) {
      // 화면을 오래 껐다 켜거나 허용 앱에 머문 뒤에는 정본 확인이 끝나기 전까지 돌려보내지 않는다.
      if (FocusReturnAccess.lease.needsConfirmation() && now - lastCheck >= 5_000) {
        lastCheck = now
        FocusReturnAccess.onNeedsSync?.invoke()
      }
      return
    }
    if (now - lastReturn < 1_200) {
      handler.removeCallbacks(evaluateTask)
      handler.postDelayed(evaluateTask, 1_200 - (now - lastReturn))
      return
    }
    val intent = packageManager.getLaunchIntentForPackage(packageName) ?: return
    intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP
    lastReturn = now
    foregroundPackage = null
    // 시스템이 연결한 접근성 서비스의 Activity 시작 권한으로 기존 작업을 앞으로 가져온다.
    runCatching { startActivity(intent) }.onFailure { FocusReturnAccess.lease.clear() }
  }

  private fun interactive(): Boolean =
    (getSystemService(POWER_SERVICE) as PowerManager).isInteractive &&
      !(getSystemService(KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked

  private fun exempt(pkg: String): Boolean {
    if (pkg in setOf(packageName, "android", "com.android.systemui")) return true
    if (pkg == (getSystemService(TELECOM_SERVICE) as TelecomManager).defaultDialerPackage) return true
    if ((getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).enabledInputMethodList.any { it.packageName == pkg }) return true
    val intents = listOf(
      Intent(Settings.ACTION_SETTINGS),
      Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME),
      Intent(Intent.ACTION_DIAL, Uri.parse("tel:")),
      Intent(AlarmClock.ACTION_SHOW_ALARMS),
    )
    if (intents.any { intent -> packageManager.queryIntentActivities(intent, PackageManager.MATCH_ALL).any { it.activityInfo.packageName == pkg } }) return true
    // 런처로 실행할 수 없는 시스템·긴급전화·권한 창은 대상으로 삼지 않는다.
    return packageManager.getLaunchIntentForPackage(pkg) == null
  }

  override fun onInterrupt() { foregroundPackage = null; FocusReturnAccess.lease.clear() }
  override fun onUnbind(intent: Intent?): Boolean { disconnect(); return super.onUnbind(intent) }
  override fun onDestroy() { disconnect(); super.onDestroy() }
  private fun disconnect() {
    handler.removeCallbacksAndMessages(null)
    foregroundPackage = null
    if (FocusReturnAccess.service === this) {
      FocusReturnAccess.service = null
      FocusReturnAccess.lease.connect(false)
    }
  }
}
