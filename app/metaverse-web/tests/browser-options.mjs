// 3D 장면은 full Chromium으로 검사한다. macOS의 headless shell은
// SwiftShader를 강제해 다중 창에서 GPU 동작을 검증할 수 없다.
export const browserOptions = {
  channel: "chromium",
  headless: true,
  args: [
    "--mute-audio",
    ...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
  ],
};
