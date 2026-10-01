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

    // subjectsJson: [{"name","seconds","color"}] (1.x와 같은 형태), totalSeconds: 오늘 총 집중(초),
    // day: JS 가 스냅샷을 계산한 KST 날짜(yyyy-MM-dd). 이 날짜를 함께 기록해, KST 자정이 지나면
    // 위젯이 빈 상태로 돌아가게 한다. JS 의 '오늘'(dayKey, KST)과 같은 기준이어야 기기 시간대가
    // KST 가 아닐 때도 오늘 값이 어제로 버려지거나 어제 값이 오늘로 남지 않는다.
    // day 는 nullable 이라 생략할 수 있다 — 날짜를 넘기지 않는 이전 JS 번들(OTA 롤백)이 불러도
    // 인자 수 오류 없이 네이티브의 KST 오늘로 기록한다. 형식이 다르면 역시 KST 오늘로 대신한다.
    AsyncFunction("updateSnapshot") { subjectsJson: String, totalSeconds: Int, day: String? ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val snapshotDate =
        day?.takeIf { StudyWidgetProvider.isDateString(it) } ?: StudyWidgetProvider.kstDateString()
      context
        .getSharedPreferences(StudyWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .putString(StudyWidgetProvider.KEY_SUBJECTS_JSON, subjectsJson)
        .putInt(StudyWidgetProvider.KEY_TOTAL_SECONDS, maxOf(0, totalSeconds))
        .putString(StudyWidgetProvider.KEY_DATE, snapshotDate)
        .apply()
      StudyWidgetProvider.updateAll(context)
      true
    }
  }
}
