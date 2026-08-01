package com.oneorthree.gromo.widget

import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

// RN → 홈 위젯 데이터 브리지(GROMO-1006).
// RN이 계산한 '오늘 공부시간 상위 과목' 스냅샷을 SharedPreferences에 저장하고
// 배치된 위젯을 즉시 갱신한다. iOS의 App Group 스냅샷 저장(ScreenTimeModule)에 대응.
class StudyWidgetModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  // subjectsJson: [{"name","seconds","color"}] — iOS Live Activity otherSubjects와 같은 형태.
  // 저장 시점의 로컬 날짜를 함께 기록해, 자정이 지나면 위젯이 빈 상태로 돌아가게 한다.
  @ReactMethod
  fun updateTopSubjects(subjectsJson: String, promise: Promise) {
    try {
      val context = reactApplicationContext
      context
        .getSharedPreferences(StudyWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .putString(StudyWidgetProvider.KEY_SUBJECTS_JSON, subjectsJson)
        .putString(StudyWidgetProvider.KEY_DATE, StudyWidgetProvider.localDateString())
        .apply()
      StudyWidgetProvider.updateAll(context)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("E_WIDGET_UPDATE", e)
    }
  }

  companion object {
    const val NAME = "StudyWidgetModule"
  }
}
