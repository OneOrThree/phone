package com.oneorthree.gromo.screentime

import android.content.Context
import android.content.SharedPreferences
import android.app.usage.UsageStatsManager
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.mockito.Mockito.*
import java.time.Instant

class AndroidStateTest {
  private val strings = mutableMapOf<String, String?>()
  private val context = mock(Context::class.java)
  private val prefs = mock(SharedPreferences::class.java)
  private val editor = mock(SharedPreferences.Editor::class.java)
  init {
    `when`(context.getSharedPreferences(anyString(), anyInt())).thenReturn(prefs)
    `when`(context.getSystemService(Context.USAGE_STATS_SERVICE)).thenReturn(mock(UsageStatsManager::class.java))
    `when`(prefs.getString(anyString(), nullable(String::class.java))).thenAnswer { call -> strings[call.getArgument(0)] ?: call.getArgument(1) }
    `when`(prefs.edit()).thenReturn(editor)
    `when`(editor.putString(anyString(), nullable(String::class.java))).thenAnswer { call -> strings[call.getArgument(0)] = call.getArgument(1); editor }
    `when`(editor.remove(anyString())).thenAnswer { call -> strings.remove(call.getArgument<String>(0)); editor }
    `when`(editor.clear()).thenAnswer { strings.clear(); editor }
    `when`(editor.commit()).thenReturn(true)
  }

  private fun state(id: String = "session", version: Long = 1, phase: String = "focus", owner: String = "owner") = JSONObject()
    .put("owner", owner).put("sessionId", id).put("version", version).put("phase", phase)
    .put("anchorMs", System.currentTimeMillis() - 1000).put("validUntilMs", System.currentTimeMillis() + 60_000)

  @Test fun endedSessionCannotBeResurrectedByLateLocalOrRemoteMessage() {
    val store = FocusSessionState(context)
    store.bind("owner")
    assertTrue(store.accept(state(), false))
    assertTrue(store.accept(state(version = 3, phase = "ended"), true))
    assertFalse(FocusSessionState(context).accept(state(version = 4), false))
    assertFalse(store.accept(state(version = 2), true))
  }
  @Test fun wrongAccountUnregisteredSessionAndOldVersionsAreRejected() {
    val store = FocusSessionState(context)
    store.bind("owner")
    assertFalse(store.accept(state(), true))
    assertTrue(store.accept(state(version = 4), false))
    assertFalse(store.accept(state(version = 3), true))
    assertFalse(store.accept(state(id = "other"), true))
    assertFalse(store.accept(state(owner = "other"), true))
  }
  @Test fun expiredSnapshotCannotStartBlocking() {
    val store = FocusSessionState(context)
    store.bind("owner")
    assertFalse(store.accept(state().put("validUntilMs", 1), false))
  }

  private fun ledger(time: () -> Long, usage: (Set<String>?, Long, Long) -> Long?) =
    MeasurementLedger(context, time, { time() - Instant.parse("2026-10-01T00:00:00Z").toEpochMilli() }, usage)

  @Test fun utcReportQueriesNineAmToNineAmKstAndDoesNotRenameLocalDayTotal() {
    val instant = Instant.parse("2026-10-12T02:00:00Z").toEpochMilli()
    strings["ledger"] = """{"owner":"owner","selections":[{"at":${instant - 3 * 86400000L},"all":true,"packages":[]}]}"""
    val windows = mutableListOf<Pair<Long, Long>>()
    val value = ledger({ instant }) { _, from, until -> windows.add(from to until); 72 * 60000L }.snapshot(true)
    val observations = value["observations"] as List<*>
    val closed = observations[0] as Map<*, *>
    assertEquals("2026-10-11", closed["date"])
    assertEquals(72, closed["minutes"])
    assertTrue(windows.contains(Instant.parse("2026-10-11T00:00:00Z").toEpochMilli() to Instant.parse("2026-10-12T00:00:00Z").toEpochMilli()))
    assertEquals("authorized", (observations[1] as Map<*, *>)["measurementStatus"])
    assertEquals(false, (observations[1] as Map<*, *>)["finalized"])
    assertEquals(true, closed["finalized"])
    val kst = observations[2] as Map<*, *>
    assertEquals("Asia/Seoul", kst["timezone"])
    assertEquals("2026-10-10T15:00:00Z", kst["windowStart"])
    assertEquals("2026-10-11T15:00:00Z", kst["windowEnd"])
  }
  @Test fun selectionChangeIsScheduledAtKstMidnightAndInvalidatesCrossingUtcWindow() {
    var time = Instant.parse("2026-10-11T10:00:00Z").toEpochMilli()
    strings["ledger"] = """{"owner":"owner","selections":[{"at":${time - 3 * 86400000L},"all":false,"packages":["old"]}]}"""
    val ledger = ledger({ time }) { _, _, _ -> 0 }
    assertEquals(true, ledger.select("owner", listOf("new"), false)["pending"])
    val saved = JSONObject(strings["ledger"]!!).getJSONArray("selections")
    assertEquals(Instant.parse("2026-10-11T15:00:00Z").toEpochMilli(), saved.getJSONObject(1).getLong("at"))
    time = Instant.parse("2026-10-12T01:00:00Z").toEpochMilli()
    val observations = ledger.snapshot(true)["observations"] as List<*>
    assertEquals("unavailable", (observations[0] as Map<*, *>)["measurementStatus"])
  }
  @Test fun missingSourceAndRevokedPermissionAreNeverReportedAsZero() {
    val time = Instant.parse("2026-10-12T01:00:00Z").toEpochMilli()
    strings["ledger"] = """{"owner":"owner","selections":[{"at":${time - 3 * 86400000L},"all":true,"packages":[]}]}"""
    val ledger = ledger({ time }) { _, _, _ -> null }
    val missing = (ledger.snapshot(true)["observations"] as List<*>)[0] as Map<*, *>
    assertNull(missing["minutes"])
    assertEquals("unavailable", missing["measurementStatus"])
    val denied = (ledger.snapshot(false)["observations"] as List<*>)[0] as Map<*, *>
    assertNull(denied["minutes"])
    assertEquals("denied", denied["measurementStatus"])
  }
  @Test fun selectionWriteFromPreviousAccountIsRejected() {
    strings["ledger"] = """{"owner":"new-owner","selections":[]}"""
    val ledger = ledger({ System.currentTimeMillis() }) { _, _, _ -> 0 }
    assertThrows(IllegalStateException::class.java) { ledger.select("old-owner", listOf("app"), false) }
    assertThrows(IllegalStateException::class.java) { ledger.allow("old-owner", listOf("app")) }
    assertEquals("new-owner", JSONObject(strings["ledger"]!!).getString("owner"))
  }
  @Test fun remoteStateSurvivesServiceLossAndRestoresOnlyKnownSession() {
    val store = FocusSessionState(context)
    store.bind("owner")
    store.accept(state().put("validUntilMs", 0), false)
    val restored = mutableListOf<Boolean>()
    val delivery = FocusRemoteDelivery(context) { restored.add(it) }
    delivery.receive(state(version = 2, phase = "rest").toString())
    assertEquals("rest", FocusSessionState(context).snapshot()!!.getString("phase"))
    delivery.receive(state(version = 3).put("validUntilMs", 0).toString())
    assertEquals(0L, FocusSessionState(context).snapshot()!!.getLong("validUntilMs"))
    delivery.receive(state(version = 4, phase = "ended").toString())
    assertEquals("ended", FocusSessionState(context).snapshot()!!.getString("phase"))
    delivery.receive(state(version = 5).toString())
    delivery.receive(state(id = "unknown", version = 6).toString())
    delivery.receive(state(owner = "other", version = 6).toString())
    assertEquals(listOf(false, false, true), restored)
  }

  @Test fun focusHasNoArtificialExpiryButRestStillNeedsDeadline() {
    val store = FocusSessionState(context)
    store.bind("owner")
    assertTrue(store.accept(state().put("validUntilMs", 0), false))
    assertFalse(store.accept(state(version = 2, phase = "rest").put("validUntilMs", 0), true))
    assertEquals("focus", store.snapshot()!!.getString("phase"))
  }

  @Test fun repeatedDeniedSnapshotsMergeGapsWithoutBridgingHealthyIntervals() {
    var time = Instant.parse("2026-10-12T01:00:00Z").toEpochMilli()
    strings["ledger"] = """{"owner":"owner","selections":[{"at":${time - 3 * 86400000L},"all":true,"packages":[]}]}"""
    val ledger = ledger({ time }) { _, _, _ -> 0 }
    val first = time
    repeat(2000) { ledger.snapshot(false); time += 60_000 }
    var gaps = JSONObject(strings["ledger"]!!).getJSONArray("gaps")
    assertEquals(1, gaps.length())
    assertEquals(first, gaps.getJSONObject(0).getLong("from"))
    ledger.snapshot(true)
    time += 3_600_000
    ledger.snapshot(true)
    time += 60_000
    ledger.snapshot(false)
    gaps = JSONObject(strings["ledger"]!!).getJSONArray("gaps")
    assertEquals(2, gaps.length())
    assertTrue(gaps.getJSONObject(0).getLong("until") < gaps.getJSONObject(1).getLong("from"))
  }

}
