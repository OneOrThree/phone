package com.oneorthree.gromo.widget

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

// StudyWidgetModule 수동 등록 패키지 — MainApplication packageList에 추가된다(GROMO-1006).
class StudyWidgetPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == StudyWidgetModule.NAME) StudyWidgetModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
    ReactModuleInfoProvider {
      mapOf(
        StudyWidgetModule.NAME to ReactModuleInfo(
          StudyWidgetModule.NAME,
          StudyWidgetModule::class.java.name,
          false, // canOverrideExistingModule
          false, // needsEagerInit
          false, // isCxxModule
          false, // isTurboModule — 레거시 모듈(인터롭 레이어로 NativeModules에 노출)
        ),
      )
    }
}
