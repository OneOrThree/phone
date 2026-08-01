package com.oneorthree.gromo.screentime

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import java.lang.ref.WeakReference

// 집중 차단 액티비티(GROMO-996) — 비허용앱 위에 뜨는 가림막의 폴백 경로(코드리뷰 반영).
// 기본 표시는 FocusSessionService의 WindowManager 오버레이가 담당하고(안드15의 서비스發
// startActivity 제약 대응), 오버레이 addView가 거부된 경우에만 이 액티비티를 시도한다.
// 레이아웃은 오버레이와 공유한다(FocusBlockContentView).
class FocusBlockActivity : Activity() {
  companion object {
    // 표시 중인 인스턴스 — 실드가 꺼질 때 서비스가 남은 차단 화면을 닫는 데 쓴다.
    @Volatile private var current: WeakReference<FocusBlockActivity>? = null

    fun closeIfShowing() {
      current?.get()?.let { activity -> activity.runOnUiThread { activity.finish() } }
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    current = WeakReference(this)
    setContentView(FocusBlockContentView.build(this) { returnToApp() })
  }

  override fun onResume() {
    super.onResume()
    // 실드가 이미 꺼졌는데 남아 있는 차단 화면(서비스 강제 종료 직후 등)은 스스로 닫는다.
    if (!FocusSessionService.isShieldActive()) finish()
  }

  override fun onDestroy() {
    if (current?.get() === this) current = null
    super.onDestroy()
  }

  // 뒤로가기 — 차단한 앱으로 돌아가면 다음 폴링에 다시 차단되는 왕복만 생기므로 홈으로 보낸다.
  // (MainActivity가 enableOnBackInvokedCallback=false라 구식 콜백이 그대로 동작한다.)
  @Deprecated("Deprecated in Java")
  override fun onBackPressed() {
    startActivity(
      Intent(Intent.ACTION_MAIN)
        .addCategory(Intent.CATEGORY_HOME)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
    finish()
  }

  private fun returnToApp() {
    packageManager.getLaunchIntentForPackage(packageName)?.let { startActivity(it) }
    finish()
  }
}
