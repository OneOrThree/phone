// 기존 동작 회귀 검사는 재방문 상태에서 시작한다. 첫 입장 계약은 welcome-qa에서 검증한다.
export async function returningVisitor(page) {
  await page.addInitScript(() => {
    const key = "cattus-island-profile-v1";
    if (!localStorage.getItem(key))
      localStorage.setItem(
        key,
        JSON.stringify({ name: "산책하는 고양이", color: "cream" }),
      );
  });
}
