package com.oneorthree.gromo.screentime

/** 서버에서 확인한 집중만 짧게 유지한다. 디스크·기기 시각·옛 28일 복원 상태를 사용하지 않는다. */
internal class FocusReturnLease(private val now: () -> Long) {
  companion object { const val MAX_LEASE_MS = 120_000L }
  private var owner: String? = null
  private var session: String? = null
  private var version = -1L
  private var until = 0L
  private var connected = false

  @Synchronized fun bind(value: String) {
    if (owner != value) { clear(); owner = value }
  }
  @Synchronized fun connect(value: Boolean) {
    connected = value
    clear()
  }
  @Synchronized fun clear() { session = null; version = -1; until = 0 }
  // 일시적인 서비스 중단은 재확인 후보만 남긴다. 종료·철회 뒤에는 후보를 새로 만들지 않는다.
  @Synchronized fun expire() { until = 0 }
  @Synchronized fun reset() { clear(); owner = null }
  @Synchronized fun apply(account: String, id: String, nextVersion: Long, remainingMs: Long): Boolean {
    if (!connected || account.isBlank() || account != owner || id.isBlank() || nextVersion < 0) return false
    if (session == id && nextVersion < version) return false
    if (remainingMs <= 0) { clear(); return false }
    session = id
    version = nextVersion
    until = now() + remainingMs.coerceAtMost(MAX_LEASE_MS)
    return true
  }
  @Synchronized fun active() = connected && session != null && now() < until
  @Synchronized fun needsConfirmation() = connected && session != null && now() >= until
}
