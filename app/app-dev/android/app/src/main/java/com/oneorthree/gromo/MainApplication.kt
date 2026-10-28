package com.oneorthree.gromo

import android.app.Application
import android.content.res.Configuration
import android.util.Log

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

  override fun onCreate() {
    super.onCreate()
    // Airbridge 는 앱 시작 시점의 설치·세션 이벤트를 잡아야 하므로 React Native 가 뜨기 전에 초기화한다.
    if (BuildConfig.AIRBRIDGE_APP_NAME.isNotEmpty() && BuildConfig.AIRBRIDGE_APP_TOKEN.isNotEmpty()) {
      AirbridgeReactNative.initializeSDK(this, BuildConfig.AIRBRIDGE_APP_NAME, BuildConfig.AIRBRIDGE_APP_TOKEN)
    } else {
      Log.w("Airbridge", "앱 이름·SDK 토큰이 비어 있어 초기화를 건너뜁니다 — AIRBRIDGE_APP_TOKEN 빌드 환경 변수를 설정하세요")
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
