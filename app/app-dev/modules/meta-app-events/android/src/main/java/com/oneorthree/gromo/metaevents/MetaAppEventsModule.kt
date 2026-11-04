package com.oneorthree.gromo.metaevents

import com.facebook.FacebookSdk
import com.facebook.appevents.AppEventsLogger
import com.facebook.internal.AttributionIdentifiers
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// JS → Meta 매칭 값 브리지. 첫 항해 도착 요청에 실려 서버(CAPI)가 사용자를 매칭한다.
// SDK가 아직 초기화되지 않았으면 null.
class MetaAppEventsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MetaAppEvents")
    AsyncFunction("metaContext") {
      if (!FacebookSdk.isInitialized()) return@AsyncFunction null
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      // Meta SDK가 자기 앱 이벤트에 싣는 것과 같은 기기 광고 추적 제한 설정(GROMO-2743).
      // 광고 ID를 못 읽으면 허용을 가정하지 않는다. SDK가 값을 캐시하므로 보통 바로 돌아온다.
      val limited = AttributionIdentifiers.getAttributionIdentifiers(context)?.isTrackingLimited ?: true
      mapOf(
        "anonId" to AppEventsLogger.getAnonymousAppDeviceGUID(context),
        "advertiserTrackingEnabled" to !limited,
      )
    }
  }
}
