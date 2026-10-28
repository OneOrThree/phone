package com.oneorthree.gromo

import android.app.Application
import android.content.Context
import android.content.res.Configuration
import android.util.Log
import com.facebook.FacebookSdk

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.common.assets.ReactFontManager
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint

import co.ab180.airbridge.reactnative.AirbridgeReactNative
import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ExpoReactHostFactory

// GROMO-2395 Airbridge 앱 이름·SDK 토큰 — 대시보드 「설정 > 토큰 관리」 값. iOS 는 AppDelegate.swift 의 같은 상수.
// 비어 있으면 SDK 를 초기화하지 않는다(토큰 발급 전 빌드가 빈 토큰으로 이벤트를 보내지 않게).
private const val AIRBRIDGE_APP_NAME = ""
private const val AIRBRIDGE_APP_TOKEN = ""

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      useDevSupport = BuildConfig.DEBUG,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        }
    )
  }

  override fun attachBaseContext(base: Context) {
    super.attachBaseContext(base)
    // FacebookInitProvider는 onCreate보다 먼저 돈다. 이전 실행의 설정을 provider 초기화 전 끄고,
    // 운영·목업 판정 뒤 JS만 수집을 켠다(GROMO-2544). false setter는 SDK 초기화 전에도 안전하다.
    FacebookSdk.setAutoLogAppEventsEnabled(false)
    FacebookSdk.setAdvertiserIDCollectionEnabled(false)
  }

  override fun onCreate() {
    super.onCreate()
    // Airbridge 는 앱 시작 시점의 설치·세션 이벤트를 잡아야 하므로 React Native 가 뜨기 전에 초기화한다.
    if (AIRBRIDGE_APP_NAME.isNotEmpty() && AIRBRIDGE_APP_TOKEN.isNotEmpty()) {
      AirbridgeReactNative.initializeSDK(this, AIRBRIDGE_APP_NAME, AIRBRIDGE_APP_TOKEN)
    } else {
      Log.w("Airbridge", "앱 이름·SDK 토큰이 비어 있어 초기화를 건너뜁니다 — MainApplication.kt 의 상수를 채우세요")
    }
    // @generated begin xml-fonts-init - expo prebuild (DO NOT MODIFY) sync-14f92f61d59a404e7ce81cc3ce1e93bc28a1a6a6
    ReactFontManager.getInstance().addCustomFont(this, "Gowun", R.font.xml_gowun)
    // @generated end xml-fonts-init
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
