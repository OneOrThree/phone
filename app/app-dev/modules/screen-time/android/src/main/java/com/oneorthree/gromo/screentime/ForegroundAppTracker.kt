package com.oneorthree.gromo.screentime

/** 첫 조회는 부팅 이후 이력을 복구하고 이후에는 마지막 조회 경계만 겹쳐 읽는다. */
internal class ForegroundAppTracker {
  private var queriedAt: Long? = null
  fun read(now: Long, uptime: Long, query: (Long, Long) -> String?): String? {
    val from = queriedAt?.let { (minOf(it, now) - 1000).coerceAtLeast(0) }
      ?: (now - uptime).coerceAtLeast(0)
    val result = query(from, now)
    queriedAt = now
    return result
  }
}
