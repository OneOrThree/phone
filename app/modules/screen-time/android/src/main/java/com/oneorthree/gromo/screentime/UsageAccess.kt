package com.oneorthree.gromo.screentime

import android.app.AppOpsManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process

// Usage Access(사용 정보 접근) 허용 여부 — AppOpsManager.checkOpNoThrow(OPSTR_GET_USAGE_STATS)
// 기준(03-스크린타임-구현 §2). M1은 모듈 전용 private였지만, 목표 초과 체크 워커
// (GoalExceededCheckWorker, M4)도 같은 판정이 필요해 공용 객체로 분리했다(GROMO-997).
internal object UsageAccess {
  fun isGranted(context: Context): Boolean {
    val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      appOps.unsafeCheckOpNoThrow(
        AppOpsManager.OPSTR_GET_USAGE_STATS,
        Process.myUid(),
        context.packageName,
      )
    } else {
      @Suppress("DEPRECATION")
      appOps.checkOpNoThrow(
        AppOpsManager.OPSTR_GET_USAGE_STATS,
        Process.myUid(),
        context.packageName,
      )
    }
    // MODE_DEFAULT는 앱옵스 미기록 상태 — 매니페스트 권한 보유 여부로 판정(표준 관례).
    return if (mode == AppOpsManager.MODE_DEFAULT) {
      context.checkCallingOrSelfPermission(android.Manifest.permission.PACKAGE_USAGE_STATS) ==
        PackageManager.PERMISSION_GRANTED
    } else {
      mode == AppOpsManager.MODE_ALLOWED
    }
  }
}
