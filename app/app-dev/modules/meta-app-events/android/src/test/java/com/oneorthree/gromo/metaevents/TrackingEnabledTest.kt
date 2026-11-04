package com.oneorthree.gromo.metaevents

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TrackingEnabledTest {
  @Test
  fun 광고_ID를_읽고_제한하지_않았으면_허용() {
    assertTrue(trackingEnabled("ad-id", trackingLimited = false))
  }

  @Test
  fun 광고_추적을_제한한_기기는_거부() {
    assertFalse(trackingEnabled("00000000-0000-0000-0000-000000000000", trackingLimited = true))
  }

  @Test
  fun 광고_ID_없이_돌아온_SDK_기본_객체는_거부() {
    assertFalse(trackingEnabled(null, trackingLimited = false))
  }

  @Test
  fun 식별자를_못_읽으면_거부() {
    assertFalse(trackingEnabled(null, trackingLimited = true))
  }
}
