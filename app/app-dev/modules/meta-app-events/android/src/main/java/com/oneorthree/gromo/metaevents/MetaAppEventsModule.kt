package com.oneorthree.gromo.metaevents

import android.os.Bundle
import com.facebook.FacebookSdk
import com.facebook.appevents.AppEventsLogger
import com.facebook.internal.AttributionIdentifiers
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 기기 광고 추적 제한 설정을 CAPI advertiser_tracking_enabled 로 옮긴다(GROMO-2743).
 * SDK는 광고 ID를 못 읽어도 isTrackingLimited=false 인 기본 객체를 돌려줄 수 있어,
 * 광고 ID를 실제로 읽은 경우에만 그 설정을 믿고 아니면 허용을 가정하지 않는다.
 */
internal fun trackingEnabled(advertiserId: String?, trackingLimited: Boolean): Boolean =
  advertiserId != null && !trackingLimited

// JS → Meta 매칭 값 브리지. 첫 항해 도착 요청에 실려 서버(CAPI)가 사용자를 매칭한다.
// SDK가 아직 초기화되지 않았으면 null.
class MetaAppEventsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MetaAppEvents")
    AsyncFunction("logEvent") { name: String, eventId: String ->
      if (!FacebookSdk.isInitialized()) return@AsyncFunction false
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      AppEventsLogger.newLogger(context).logEvent(name, Bundle().apply { putString("event_id", eventId) })
      true
    }
    AsyncFunction("metaContext") {
      if (!FacebookSdk.isInitialized()) return@AsyncFunction null
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      // Meta SDK가 자기 앱 이벤트에 싣는 것과 같은 값이다. SDK가 캐시하므로 보통 바로 돌아온다.
      val ids = AttributionIdentifiers.getAttributionIdentifiers(context)
      mapOf(
        "anonId" to AppEventsLogger.getAnonymousAppDeviceGUID(context),
        "advertiserTrackingEnabled" to trackingEnabled(ids?.androidAdvertiserId, ids?.isTrackingLimited ?: true),
      )
    }
  }
}
