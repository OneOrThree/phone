package com.oneorthree.gromo.screentime

import org.junit.Assert.*
import org.junit.Test

class FocusReturnLeaseTest {
  @Test fun onlyBoundOwnerAndConnectedServiceCanStart() {
    val lease = FocusReturnLease { 100L }
    lease.bind("owner")
    assertFalse(lease.apply("owner", "s", 1, 120_000))
    lease.connect(true)
    assertFalse(lease.apply("other", "s", 1, 120_000))
    assertFalse(lease.apply("owner", "s", -1, 120_000))
    assertTrue(lease.apply("owner", "s", 2, 120_000))
    assertFalse(lease.apply("owner", "s", 1, 120_000))
    assertTrue(lease.active())
  }
  @Test fun elapsedDeadlineIsCappedAndExpiredLeaseNeedsFreshConfirmation() {
    var time = 1_000L
    val lease = FocusReturnLease { time }
    lease.bind("owner"); lease.connect(true)
    assertTrue(lease.apply("owner", "s", 1, 28 * 86400000L))
    time += 119_999
    assertTrue(lease.active())
    time++
    assertFalse(lease.active())
    assertTrue(lease.needsConfirmation())
    assertTrue(lease.apply("owner", "s", 1, 30_000))
    time += 30_000
    assertFalse(lease.active())
  }
  @Test fun transientFailureRequiresConfirmationButNeverRevivesAnEndedSession() {
    val lease = FocusReturnLease { 100L }
    lease.bind("owner"); lease.connect(true)
    lease.apply("owner", "s", 1, 120_000)
    lease.expire()
    assertFalse(lease.active())
    assertTrue(lease.needsConfirmation())
    assertTrue(lease.apply("owner", "s", 1, 120_000))
    lease.clear(); lease.expire()
    assertFalse(lease.active())
    assertFalse(lease.needsConfirmation())
  }
  @Test fun restEndAccountSwitchAndReconnectNeverRestoreOldFocus() {
    val lease = FocusReturnLease { 100L }
    lease.bind("owner"); lease.connect(true)
    lease.apply("owner", "s", 1, 120_000)
    lease.clear()
    assertFalse(lease.active()); assertFalse(lease.needsConfirmation())
    lease.apply("owner", "s", 2, 120_000)
    lease.connect(false); lease.connect(true)
    assertFalse(lease.active()); assertFalse(lease.needsConfirmation())
    lease.apply("owner", "s", 2, 120_000)
    lease.bind("other")
    assertFalse(lease.active())
    assertFalse(lease.apply("owner", "s", 3, 120_000))
    lease.reset()
    assertFalse(lease.apply("other", "s", 3, 120_000))
    assertFalse(FocusReturnLease { 100L }.active())
  }
}
