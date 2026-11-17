const response = http.get("http://127.0.0.1:18735/__expire");
if (response.status !== 200)
  throw new Error("로컬 토큰 만료 설정 실패: " + response.status);
