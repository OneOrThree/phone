package com.oneorthree.gromo.screentime

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * 집중 가림막 창 — iOS `ShieldConfigurationExtension`이 그리는 화면의 안드로이드 대응물이다.
 *
 * 문구는 iOS와 **같은 것을 쓴다**. 같은 상황에서 두 플랫폼이 다른 말을 하면 같은 제품으로
 * 읽히지 않는다(ios/ShieldConfiguration/ShieldConfigurationExtension.swift 참고).
 *
 * 버튼만 다르다 — iOS의 '닫기'는 OS가 그 앱을 실제로 닫아주지만, 안드로이드는 남의 앱을
 * 죽일 수 없다. 그래서 우리 앱으로 돌아오게 하는 버튼으로 바꿨다. 없는 능력을 있는 척하는
 * 라벨('닫기')을 쓰면 눌러도 그 앱이 그대로 남아 고장으로 보인다.
 */
class ShieldOverlay(private val context: Context) {

  companion object {
    // 색은 src/constants/theme.ts의 night 팔레트와 같은 값이다(iOS는 생성된 Palette.swift를 쓴다).
    // 여기서 값을 바꾸면 세 곳이 갈린다 — theme.ts를 정본으로 보고 함께 고칠 것.
    private const val BG = "#1A1D2E" // night.bottom
    private const val CREAM = "#D9DCF0" // night.cream — 제목
    private const val MUTED = "#8B90A8" // night.muted — 부제
    private const val ACCENT = "#5E6AD2" // accent — 버튼
  }

  private val windowManager =
    context.getSystemService(Context.WINDOW_SERVICE) as WindowManager

  private var view: View? = null

  val isShowing: Boolean
    get() = view != null

  fun show(subject: String) {
    if (view != null) return
    // 권한이 없으면 창을 올릴 수 없다 — 조용히 실패하는 대신 아무것도 안 한 상태로 둔다.
    // (호출부는 시작 시점에 권한을 확인해 실드 성공 여부를 JS에 알린다.)
    if (!canDrawOverlays(context)) return

    val content = buildView(subject)
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }
    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      type,
      // NOT_TOUCH_MODAL을 빼서 이 창이 터치를 **전부** 먹게 한다 — 안 그러면 가림막 아래
      // 차단 앱을 그대로 조작할 수 있어 덮은 의미가 없다.
      WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
      android.graphics.PixelFormat.OPAQUE,
    )
    params.gravity = Gravity.CENTER
    try {
      windowManager.addView(content, params)
      view = content
    } catch (_: Exception) {
      // 권한이 방금 회수됐거나 제조사 제약으로 실패할 수 있다. 다음 폴링에서 다시 시도한다.
      view = null
    }
  }

  fun hide() {
    val current = view ?: return
    view = null
    try {
      windowManager.removeView(current)
    } catch (_: Exception) {
      // 이미 떨어진 창 — 무시.
    }
  }

  @SuppressLint("SetTextI18n")
  private fun buildView(subject: String): View {
    val root = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(Color.parseColor(BG))
      val pad = dp(28)
      setPadding(pad, pad, pad, pad)
      // 가림막 뒤로 터치가 새지 않게 클릭 소비.
      isClickable = true
      isFocusable = true
    }

    // 캐릭터 — iOS ShieldConfiguration이 focusCharacter.png를 아이콘으로 쓰는 자리와 같다.
    // 없으면(스냅샷 실패·첫 세션) 조용히 건너뛴다. 가림막의 본체는 문구지 그림이 아니다.
    characterBitmap()?.let { bitmap ->
      root.addView(
        android.widget.ImageView(context).apply {
          setImageBitmap(bitmap)
          val size = dp(96)
          layoutParams = LinearLayout.LayoutParams(size, size).apply { bottomMargin = dp(20) }
        },
      )
    }

    root.addView(
      TextView(context).apply {
        text = "지금은 집중 시간이에요!"
        setTextColor(Color.parseColor(CREAM))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
        typeface = android.graphics.Typeface.DEFAULT_BOLD
        gravity = Gravity.CENTER
      },
    )

    root.addView(
      TextView(context).apply {
        // iOS 부제와 같은 문구·같은 줄바꿈.
        text = "$subject 집중이 끝날 때까지\n이 앱은 잠깐 잠갔어요. 얼른 돌아오세요!"
        setTextColor(Color.parseColor(MUTED))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        gravity = Gravity.CENTER
        setLineSpacing(dp(4).toFloat(), 1f)
        val top = dp(12)
        setPadding(0, top, 0, dp(28))
      },
    )

    root.addView(
      Button(context).apply {
        text = "gromo로 돌아가기"
        setTextColor(Color.WHITE)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        isAllCaps = false
        background = GradientDrawable().apply {
          cornerRadius = dp(14).toFloat()
          setColor(Color.parseColor(ACCENT))
        }
        setPadding(dp(32), dp(14), dp(32), dp(14))
        setOnClickListener { returnToApp() }
      },
    )

    return root
  }

  /** 우리 앱을 앞으로 — 차단 앱이 뒤로 밀리면서 가림막도 다음 폴링에 걷힌다. */
  private fun returnToApp() {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    launch.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      context.startActivity(launch)
    } catch (_: Exception) {
      // 실행 실패해도 가림막은 그대로 남아 차단은 유지된다.
    }
  }

  /** 세션 시작 시 JS가 저장한 캐릭터 스냅샷(FocusShieldService와 같은 파일). */
  private fun characterBitmap(): android.graphics.Bitmap? = runCatching {
    val file = java.io.File(context.filesDir, ScreenTimeModule.CHARACTER_FILE)
    if (!file.exists()) null else android.graphics.BitmapFactory.decodeFile(file.path)
  }.getOrNull()

  private fun dp(value: Int): Int =
    (value * context.resources.displayMetrics.density).toInt()
}

/** '다른 앱 위에 표시' 권한 보유 여부. 이게 없으면 가림막을 아예 못 띄운다. */
fun canDrawOverlays(context: Context): Boolean =
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) Settings.canDrawOverlays(context) else true
