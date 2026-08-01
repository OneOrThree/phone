package com.oneorthree.gromo.screentime

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import java.io.File
import java.lang.ref.WeakReference

// 집중 차단 화면(GROMO-996) — 비허용앱 위에 뜨는 가림막. iOS ShieldConfiguration 익스텐션의
// 대응물인데, 같은 앱 안이라 App Group 곡예 없이 우리 화면으로 직접 그린다(03 문서 §5).
// 문구·색은 iOS 가림막(ShieldConfigurationExtension.swift, 시안 17번)과 동일: 다크 배경 +
// 캐릭터 스냅샷 + "지금은 집중 시간이에요!" 해요체. 스냅샷이 없으면 텍스트만으로 동작한다.
// 레이아웃 리소스 없이 코드로 그려 모듈 안에서 자족한다.
class FocusBlockActivity : Activity() {
  companion object {
    // 표시 중인 인스턴스 — 실드가 꺼질 때 서비스가 남은 차단 화면을 닫는 데 쓴다.
    @Volatile private var current: WeakReference<FocusBlockActivity>? = null

    fun closeIfShowing() {
      current?.get()?.let { activity -> activity.runOnUiThread { activity.finish() } }
    }

    // iOS 가림막 팔레트(Palette.night — theme.ts에서 생성된 값)와 동일.
    private const val BG_TOP = 0xFF2A2E45.toInt() // night.top
    private const val BG_BOTTOM = 0xFF1A1D2E.toInt() // night.bottom
    private const val TEXT_CREAM = 0xFFD9DCF0.toInt() // night.cream — 제목
    private const val TEXT_MUTED = 0xFF8B90A8.toInt() // night.muted — 부제
    private const val ACCENT = 0xFF5E6AD2.toInt() // accent — 버튼
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    current = WeakReference(this)

    val subject = getSharedPreferences(ScreenTimeModule.PREFS_NAME, Context.MODE_PRIVATE)
      .getString(ScreenTimeModule.KEY_FOCUS_SHIELD_SUBJECT, null) ?: "집중"

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setPadding(dp(32), dp(32), dp(32), dp(32))
      background = GradientDrawable(
        GradientDrawable.Orientation.TOP_BOTTOM,
        intArrayOf(BG_TOP, BG_BOTTOM),
      )
    }

    // 캐릭터 스냅샷(세션 시작 시 saveCharacterSnapshot이 저장) — 없으면 텍스트만.
    val snapshot = File(filesDir, ScreenTimeModule.SNAPSHOT_FILE_NAME)
    if (snapshot.exists()) {
      BitmapFactory.decodeFile(snapshot.path)?.let { bitmap ->
        val image = ImageView(this).apply {
          setImageBitmap(bitmap)
          scaleType = ImageView.ScaleType.FIT_CENTER
        }
        root.addView(
          image,
          LinearLayout.LayoutParams(dp(140), dp(140)).apply { bottomMargin = dp(28) },
        )
      }
    }

    val title = TextView(this).apply {
      text = "지금은 집중 시간이에요!"
      setTextColor(TEXT_CREAM)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
      setTypeface(typeface, android.graphics.Typeface.BOLD)
      gravity = Gravity.CENTER
    }
    root.addView(title, linearParams())

    val subtitle = TextView(this).apply {
      text = "$subject 집중이 끝날 때까지\n이 앱은 잠깐 잠갔어요. 얼른 돌아오세요!"
      setTextColor(TEXT_MUTED)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
      setLineSpacing(dp(4).toFloat(), 1f)
      gravity = Gravity.CENTER
    }
    root.addView(subtitle, linearParams().apply { topMargin = dp(12) })

    // iOS 가림막의 primary 버튼('닫기')은 차단된 앱에 머무르지만, 안드로이드에선 닫으면
    // 차단한 앱으로 돌아가 다시 차단되는 왕복만 생긴다 — 동작을 'gromo 복귀'로 바꾼다.
    val returnButton = TextView(this).apply {
      text = "gromo로 돌아가기"
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
      setTypeface(typeface, android.graphics.Typeface.BOLD)
      gravity = Gravity.CENTER
      setPadding(dp(28), dp(14), dp(28), dp(14))
      background = GradientDrawable().apply {
        setColor(ACCENT)
        cornerRadius = dp(14).toFloat()
      }
      setOnClickListener { returnToApp() }
    }
    root.addView(returnButton, linearParams().apply { topMargin = dp(36) })

    setContentView(root)
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

  private fun linearParams() = LinearLayout.LayoutParams(
    LinearLayout.LayoutParams.WRAP_CONTENT,
    LinearLayout.LayoutParams.WRAP_CONTENT,
  )

  private fun dp(value: Int): Int =
    TypedValue.applyDimension(
      TypedValue.COMPLEX_UNIT_DIP,
      value.toFloat(),
      resources.displayMetrics,
    ).toInt()
}
