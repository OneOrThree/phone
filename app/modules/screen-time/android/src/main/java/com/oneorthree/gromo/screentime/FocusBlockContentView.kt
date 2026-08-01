package com.oneorthree.gromo.screentime

import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import java.io.File

// 집중 차단 화면 공용 콘텐츠(GROMO-996, 코드리뷰 반영) — 같은 레이아웃을 두 표시 경로가 공유한다:
//  1. FocusSessionService의 WindowManager 오버레이(기본) — 안드15(API 35)에선 서비스發
//     startActivity가 '보이는 오버레이 창'이 있어야 허용되므로 차단 화면 자체를 오버레이로 띄운다.
//  2. FocusBlockActivity(폴백) — 오버레이 addView가 거부된 경우의 액티비티 경로.
// 문구·색은 iOS 가림막(ShieldConfigurationExtension.swift, 시안 17번)과 동일: 다크 배경 +
// 캐릭터 스냅샷 + "지금은 집중 시간이에요!" 해요체. 스냅샷이 없으면 텍스트만으로 동작한다.
// 레이아웃 리소스 없이 코드로 그려 모듈 안에서 자족한다.
internal object FocusBlockContentView {
  // iOS 가림막 팔레트(Palette.night — theme.ts에서 생성된 값)와 동일.
  private const val BG_TOP = 0xFF2A2E45.toInt() // night.top
  private const val BG_BOTTOM = 0xFF1A1D2E.toInt() // night.bottom
  private const val TEXT_CREAM = 0xFFD9DCF0.toInt() // night.cream — 제목
  private const val TEXT_MUTED = 0xFF8B90A8.toInt() // night.muted — 부제
  private const val ACCENT = 0xFF5E6AD2.toInt() // accent — 버튼

  // 차단 콘텐츠 뷰 생성 — onReturnToApp: 'gromo로 돌아가기' 버튼 동작(표시 경로별로 다르다:
  // 오버레이는 서비스가 앱 실행 후 창 제거, 액티비티는 앱 실행 후 finish).
  fun build(context: Context, onReturnToApp: () -> Unit): View {
    val subject = context.getSharedPreferences(ScreenTimeModule.PREFS_NAME, Context.MODE_PRIVATE)
      .getString(ScreenTimeModule.KEY_FOCUS_SHIELD_SUBJECT, null) ?: "집중"

    val root = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setPadding(dp(context, 32), dp(context, 32), dp(context, 32), dp(context, 32))
      background = GradientDrawable(
        GradientDrawable.Orientation.TOP_BOTTOM,
        intArrayOf(BG_TOP, BG_BOTTOM),
      )
    }

    // 캐릭터 스냅샷(세션 시작 시 saveCharacterSnapshot이 저장) — 없으면 텍스트만.
    val snapshot = File(context.filesDir, ScreenTimeModule.SNAPSHOT_FILE_NAME)
    if (snapshot.exists()) {
      BitmapFactory.decodeFile(snapshot.path)?.let { bitmap ->
        val image = ImageView(context).apply {
          setImageBitmap(bitmap)
          scaleType = ImageView.ScaleType.FIT_CENTER
        }
        root.addView(
          image,
          LinearLayout.LayoutParams(dp(context, 140), dp(context, 140))
            .apply { bottomMargin = dp(context, 28) },
        )
      }
    }

    val title = TextView(context).apply {
      text = "지금은 집중 시간이에요!"
      setTextColor(TEXT_CREAM)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
      setTypeface(typeface, Typeface.BOLD)
      gravity = Gravity.CENTER
    }
    root.addView(title, linearParams())

    val subtitle = TextView(context).apply {
      text = "$subject 집중이 끝날 때까지\n이 앱은 잠깐 잠갔어요. 얼른 돌아오세요!"
      setTextColor(TEXT_MUTED)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
      setLineSpacing(dp(context, 4).toFloat(), 1f)
      gravity = Gravity.CENTER
    }
    root.addView(subtitle, linearParams().apply { topMargin = dp(context, 12) })

    // iOS 가림막의 primary 버튼('닫기')은 차단된 앱에 머무르지만, 안드로이드에선 닫으면
    // 차단한 앱으로 돌아가 다시 차단되는 왕복만 생긴다 — 동작을 'gromo 복귀'로 바꾼다.
    val returnButton = TextView(context).apply {
      text = "gromo로 돌아가기"
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
      setTypeface(typeface, Typeface.BOLD)
      gravity = Gravity.CENTER
      setPadding(dp(context, 28), dp(context, 14), dp(context, 28), dp(context, 14))
      background = GradientDrawable().apply {
        setColor(ACCENT)
        cornerRadius = dp(context, 14).toFloat()
      }
      setOnClickListener { onReturnToApp() }
    }
    root.addView(returnButton, linearParams().apply { topMargin = dp(context, 36) })

    return root
  }

  private fun linearParams() = LinearLayout.LayoutParams(
    LinearLayout.LayoutParams.WRAP_CONTENT,
    LinearLayout.LayoutParams.WRAP_CONTENT,
  )

  private fun dp(context: Context, value: Int): Int =
    TypedValue.applyDimension(
      TypedValue.COMPLEX_UNIT_DIP,
      value.toFloat(),
      context.resources.displayMetrics,
    ).toInt()
}
