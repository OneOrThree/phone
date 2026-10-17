package com.oneorthree.gromo.screentime

import android.content.Context
import android.app.usage.UsageStatsManager
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** 계정별 측정 기준·권한 공백·확정 이력. 날짜만 바꾸지 않고 UTC 구간을 직접 조회한다. */
internal class MeasurementLedger(
  private val context: Context,
  private val clock: () -> Long = System::currentTimeMillis,
  private val elapsed: () -> Long = SystemClock::elapsedRealtime,
  private val usage: ((Set<String>?, Long, Long) -> Long?)? = null,
) {
  private val prefs = context.getSharedPreferences("gromo_android_measurement_v2", Context.MODE_PRIVATE)
  private val kst = ZoneId.of("Asia/Seoul")
  private val dayMs = 86_400_000L
  private fun load() = JSONObject(prefs.getString("ledger", "{}")!!)
  private fun save(value: JSONObject) { check(prefs.edit().putString("ledger", value.toString()).commit()) }
  private fun now() = clock()
  private fun day(time: Long) = Instant.ofEpochMilli(time).atZone(kst).toLocalDate()
  private fun start(date: LocalDate) = date.atStartOfDay(kst).toInstant().toEpochMilli()
  private fun selections(value: JSONObject) = value.optJSONArray("selections") ?: JSONArray()
  private fun entries(array: JSONArray) = (0 until array.length()).map { array.getJSONObject(it) }
  private fun packages(value: JSONObject): Set<String>? = if (value.optBoolean("all")) null else
    value.getJSONArray("packages").let { a -> (0 until a.length()).map { a.getString(it) }.toSet() }

  @Synchronized fun bind(owner: String) {
    require(owner.isNotBlank())
    val value = load()
    if (value.optString("owner") == owner) return
    context.stopService(android.content.Intent(context, FocusShieldService::class.java))
    context.getSharedPreferences("gromo_screen_time", Context.MODE_PRIVATE).edit().remove("allowedPackages").commit()
    save(JSONObject().put("owner", owner).put("since", now()))
  }

  @Synchronized fun reset() { check(prefs.edit().clear().commit()) }

  @Synchronized fun breakdown(owner: String, dayOffset: Int): Map<String, Any?> {
    require(dayOffset in -1..0)
    val time = now()
    val date = day(time).plusDays(dayOffset.toLong())
    val until = minOf(time, start(date.plusDays(1)))
    val value = load()
    check(value.optString("owner") == owner && owner.isNotBlank()) { "STALE_ACCOUNT" }
    val selected = entries(selections(value)).lastOrNull { it.getLong("at") < until }
      ?: error("MEASUREMENT_NOT_CONFIGURED")
    val from = maxOf(start(date), selected.getLong("at"))
    val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val breakdown = checkNotNull(UsageSessionCalculator.confirmedBreakdown(manager, packages(selected), from, until)) {
      "MEASUREMENT_INCOMPLETE"
    }
    val byPackage = breakdown.byPackage
    val apps = byPackage.entries.filter { it.value > 0 }.sortedByDescending { it.value }.map { (pkg, millis) ->
      val label = runCatching { context.packageManager.getApplicationLabel(context.packageManager.getApplicationInfo(pkg, 0)).toString() }.getOrDefault(pkg)
      mapOf("packageName" to pkg, "label" to label, "seconds" to millis / 1000)
    }
    return mapOf("totalSeconds" to byPackage.values.sum() / 1000, "otherSeconds" to 0, "apps" to apps)
  }

  @Synchronized fun selection(): Map<String, Any?> {
    val value = load()
    val all = entries(selections(value))
    val active = all.lastOrNull { it.getLong("at") <= now() }
    val chosen = all.lastOrNull()
    val pending = chosen != null && chosen.getLong("at") > now()
    val pendingSelection = if (pending) mapOf(
      "applications" to (chosen?.let { packages(it)?.size ?: 1 } ?: 0), "categories" to 0,
      "webDomains" to 0, "allApps" to chosen?.optBoolean("all"), "pending" to true) else null
    return mapOf("configured" to (active != null), "allApps" to (chosen?.optBoolean("all") ?: false),
      "packages" to (chosen?.let { packages(it)?.sorted() } ?: emptyList<String>()),
      "pending" to pending, "pendingSelection" to pendingSelection,
      "applications" to (active?.let { packages(it)?.size ?: 1 } ?: 0), "categories" to 0, "webDomains" to 0)
  }

  @Synchronized fun select(owner: String, selected: List<String>, allApps: Boolean): Map<String, Any?> {
    require(allApps || selected.isNotEmpty()) { "SELECT_AT_LEAST_ONE_APP" }
    val value = load()
    check(value.optString("owner") == owner && owner.isNotBlank()) { "STALE_ACCOUNT" }
    val time = now()
    val kept = entries(selections(value)).filter { it.getLong("at") <= time }.takeLast(90)
    val current = kept.lastOrNull()
    if (current != null && current.optBoolean("all") == allApps && (allApps || packages(current) == selected.toSet())) {
      value.put("selections", JSONArray(kept))
    } else {
      val at = if (current == null) time else start(day(time).plusDays(1))
      value.put("selections", JSONArray(kept + JSONObject().put("at", at).put("all", allApps)
        .put("packages", JSONArray(selected.distinct()))))
    }
    save(value)
    return selection()
  }

  @Synchronized fun allow(owner: String, selected: List<String>) {
    check(load().optString("owner") == owner && owner.isNotBlank()) { "STALE_ACCOUNT" }
    check(context.getSharedPreferences("gromo_screen_time", Context.MODE_PRIVATE).edit()
      .putStringSet("allowedPackages", selected.toSet()).commit())
  }

  @Synchronized fun snapshot(approved: Boolean): Map<String, Any?> {
    val value = load()
    check(value.optString("owner").isNotEmpty()) { "MEASUREMENT_OWNER_REQUIRED" }
    val time = now()
    val last = value.optLong("seen", time)
    val boot = time - elapsed()
    val gaps = value.optJSONArray("gaps") ?: JSONArray()
    val changedBoot = value.has("boot") && kotlin.math.abs(boot - value.getLong("boot")) > 60_000
    // 재부팅·시계 역행·장기 미관측·발견한 권한 공백은 확정 기록으로 승격하지 않는다.
    if (!approved || !value.optBoolean("granted", approved) || changedBoot || time < last || time - last > dayMs * 2) {
      gaps.put(JSONObject().put("from", minOf(last, time)).put("until", maxOf(last, time) + 1))
    }
    // 연속 거절·겹친 권한 공백은 하나의 구간으로 저장한다. 기존 누적 원장도 함께 압축한다.
    val merged = mutableListOf<JSONObject>()
    for (gap in entries(gaps).filter { it.getLong("until") >= time - dayMs * 92 }.sortedBy { it.getLong("from") }) {
      val previous = merged.lastOrNull()
      if (previous != null && gap.getLong("from") <= previous.getLong("until")) {
        previous.put("until", maxOf(previous.getLong("until"), gap.getLong("until")))
      } else merged.add(gap)
    }
    value.put("gaps", JSONArray(merged))
      .put("seen", time).put("boot", boot).put("granted", approved)
    save(value)
    val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val today = day(time)
    val history = value.optJSONObject("history") ?: JSONObject()
    val invalid = mutableSetOf<String>()
    fun measure(from: Long, until: Long, complete: Boolean): Int? {
      if (!approved || until <= from) return null
      val options = entries(selections(value))
      val selection = options.lastOrNull { it.getLong("at") <= from }
        ?: if (!complete) options.firstOrNull { it.getLong("at") < until } else null
      if (selection == null) return null
      if (complete && options.any { it.getLong("at") > from && it.getLong("at") < until }) return null
      if (entries(value.getJSONArray("gaps")).any { it.getLong("from") < until && it.getLong("until") > from }) return null
      return runCatching {
        (usage?.invoke(packages(selection), maxOf(from, selection.getLong("at")), until)
          ?: if (usage == null) UsageSessionCalculator.confirmedForegroundMillis(manager, packages(selection), maxOf(from, selection.getLong("at")), until) else null)
          ?.let { (it / 60_000).toInt() }
      }.getOrNull()
    }
    for (offset in 1L..2L) {
      val date = today.minusDays(offset)
      val minutes = measure(start(date), start(date.plusDays(1)), true)
      if (minutes != null) history.put(date.toString(), minutes)
      else { history.remove(date.toString()); invalid.add(date.toString()) }
    }
    val current = measure(start(today), time, false)
    if (measure(start(today), time, true) == null) invalid.add(today.toString())
    val observations = listOf("UTC", "Asia/Seoul").flatMap { timezone ->
      val zone = ZoneId.of(timezone)
      val calendarToday = Instant.ofEpochMilli(time).atZone(zone).toLocalDate()
      listOf(calendarToday.minusDays(1), calendarToday).map { date ->
        val from = date.atStartOfDay(zone).toInstant().toEpochMilli()
        val minutes = measure(from, minOf(from + dayMs, time), true)
        mapOf("date" to date.toString(), "minutes" to minutes, "measuredAt" to Instant.ofEpochMilli(time).toString(),
          "timezone" to timezone, "windowStart" to Instant.ofEpochMilli(from).toString(),
          "windowEnd" to Instant.ofEpochMilli(from + dayMs).toString(), "finalized" to (date < calendarToday),
          "measurementStatus" to if (!approved) "denied" else if (minutes != null) "authorized" else if (date == calendarToday) "pending" else "unavailable")
      }
    }
    val historyDates = history.keys().asSequence().toList().filter { it >= today.minusDays(90).toString() }
    val retained = JSONObject()
    historyDates.forEach { retained.put(it, history.getInt(it)) }
    value.put("history", retained)
    save(value)
    return mapOf("owner" to value.getString("owner"), "approved" to approved, "date" to today.toString(), "minutes" to current,
      "history" to if (approved) historyDates.sorted().map { mapOf("date" to it, "minutes" to history.getInt(it)) } else emptyList(),
      "unconfirmedDays" to invalid.sorted(), "observations" to observations)
  }
}
