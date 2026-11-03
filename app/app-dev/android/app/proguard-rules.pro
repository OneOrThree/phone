# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Add any project specific keep options here:

# 카카오 SDK — 공식 안내 규칙 (https://developers.kakao.com/docs/latest/ko/android/getting-started#project-pro-guard)
# Retrofit 2.9.0 내장 규칙엔 R8 full mode 대응이 없어, Call<T> 의 제네릭 정보가 지워지면
# 카카오 SDK 의 토큰 확인 호출이 "Call return type must be parameterized" 로 앱을 종료시킨다 (GROMO-2740).
-keep class com.kakao.sdk.**.model.* { <fields>; }
-if interface * { @retrofit2.http.* <methods>; }
-keep,allowobfuscation interface <1>
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation
-if interface * { @retrofit2.http.* public *** *(...); }
-keep,allowoptimization,allowshrinking,allowobfuscation class <3>
-keep,allowobfuscation,allowshrinking class retrofit2.Response
