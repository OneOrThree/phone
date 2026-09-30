package com.oneorthree.gromo.widget

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// JS → 홈 위젯 데이터 브리지. 1.x(GROMO-1006)는 RN 레거시 ReactPackage를 MainApplication에
// 수동 등록했지만, 2.0은 로컬 Expo 모듈(modules/screen-time과 같은 방식)로 자동 링크한다 —
// MainApplication을 건드리지 않아 expo prebuild로 android/ 를 다시 만들어도 유지된다.
class StudyWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StudyWidgetModule")

    // subjectsJson: [{"name","seconds","color"}] (1.x와 같은 형태), totalSeconds: 오늘 총 집중(초).
    // 저장 시점의 로컬 날짜를 함께 기록해, 자정이 지나면 위젯이 빈 상태로 돌아가게 한다.
    AsyncFunction("updateSnapshot") { subjectsJson: String, totalSeconds: Int ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      context
        .getSharedPreferences(StudyWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .putString(StudyWidgetProvider.KEY_SUBJECTS_JSON, subjectsJson)
        .putInt(StudyWidgetProvider.KEY_TOTAL_SECONDS, maxOf(0, totalSeconds))
        .putString(StudyWidgetProvider.KEY_DATE, StudyWidgetProvider.localDateString())
        .apply()
      StudyWidgetProvider.updateAll(context)
      true
    }
  }
}
