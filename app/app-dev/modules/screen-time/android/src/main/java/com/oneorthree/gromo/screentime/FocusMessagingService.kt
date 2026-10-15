package com.oneorthree.gromo.screentime

import android.content.Intent
import android.os.Build
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** 이미 시작한 세션의 원격 상태를 보존하고 종료된 서비스도 복구한다. */
class FocusMessagingService : FirebaseMessagingService() {
  override fun onMessageReceived(message: RemoteMessage) {
    val payload = message.data["focusActivity"] ?: return
    FocusRemoteDelivery(this) { ended ->
      val running = FocusShieldService.instance
      if (running != null) {
        running.restoreLatest()
      } else if (ended) {
        // 프로세스가 없더라도 종료 표식은 저장되고 잔존 알림은 제거된다.
        stopService(Intent(this, FocusShieldService::class.java))
        FocusShieldService.clearNotification(this)
      } else if (message.priority == RemoteMessage.PRIORITY_HIGH) {
        // FCM 우선순위가 낮아졌거나 OS가 기동을 거절해도 저장한 상태는 유실하지 않는다.
        runCatching {
          val intent = Intent(this, FocusShieldService::class.java).setAction(FocusShieldService.ACTION_RESTORE)
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent) else startService(intent)
        }
      }
    }.receive(payload)
  }
}
