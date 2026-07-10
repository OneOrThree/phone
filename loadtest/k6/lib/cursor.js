import http from 'k6/http';

// 커서 팔로우 — 첫 페이지만 치면 커서 조건 분기(id < :cursor)가 아예 안 탄다 (설계 §2-3).
// 실제 응답 필드명 nextCursor (FocusSessionSliceResponse — hasNext=false 면 null).
export function followCursor(url, params, pages = 2) {
  let res = http.get(url, params);
  for (let i = 1; i < pages; i++) {
    let cursor = null;
    try {
      cursor = res.json('nextCursor');
    } catch (_) {
      break; // 비정상 응답 — 에러율 지표가 잡는다
    }
    if (!cursor) break;
    res = http.get(`${url}&cursor=${encodeURIComponent(cursor)}`, params);
  }
  return res;
}
