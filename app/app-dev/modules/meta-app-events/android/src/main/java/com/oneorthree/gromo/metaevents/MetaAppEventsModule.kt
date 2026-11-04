package com.oneorthree.gromo.metaevents

import com.facebook.FacebookSdk
import com.facebook.appevents.AppEventsLogger
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// JS → Meta 설치 익명 ID 브리지. 첫 항해 도착 요청에 실려 서버(CAPI)가 사용자를 매칭한다.
// SDK가 아직 초기화되지 않았으면 null.
class MetaAppEventsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MetaAppEvents")
    AsyncFunction("anonymousId") {
      if (!FacebookSdk.isInitialized()) return@AsyncFunction null
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      AppEventsLogger.getAnonymousAppDeviceGUID(context)
    }
  }
}
