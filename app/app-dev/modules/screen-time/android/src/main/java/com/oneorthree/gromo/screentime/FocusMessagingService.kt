package com.oneorthree.gromo.screentime

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** 표시 중인 집중 알림만 갱신한다. 메시지 수신으로 새로운 차단을 시작하지 않는다. */
class FocusMessagingService : FirebaseMessagingService() {
  override fun onMessageReceived(message: RemoteMessage) {
    val payload = message.data["focusActivity"] ?: return
    if (payload.length > 8192) return
    FocusShieldService.instance?.applyRemote(payload)
  }
}
