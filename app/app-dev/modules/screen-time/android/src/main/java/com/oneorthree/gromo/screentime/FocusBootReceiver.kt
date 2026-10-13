package com.oneorthree.gromo.screentime

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/** 부팅 완료 뒤 로그인 계정의 진행 중 세션만 복구한다. */
class FocusBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    runCatching { FocusSessionState(context).restorableSnapshot() }.getOrNull() ?: return
    runCatching {
      val restore = Intent(context, FocusShieldService::class.java).setAction(FocusShieldService.ACTION_RESTORE)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(restore) else context.startService(restore)
    }
  }
}
