const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { renderCensoredAsset, runProcess } = require("../electron/ai-censorship.cjs");

sharp.cache(false);

test("AI 탐지 영역을 설정한 방식으로 검열 이미지에 반영한다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaa-ai-censor-"));
  try {
    const input = path.join(root, "input.png");
    const output = path.join(root, "output.png");
    await sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toFile(input);
    await renderCensoredAsset(input, output, [
      { box: [5, 5, 15, 15], polygon: [[5, 5], [15, 5], [10, 15]], label: "target", confidence: 0.9 },
      { box: [1, 1, 6, 6], polygon: [[1, 1], [6, 1], [6, 6], [1, 6]], label: "target", confidence: 0.8 }
    ], { method: "solid", color: "#0000ff", dilation: 0, hardness: 100, opacity: 100 });
    const { data, info } = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const center = (10 * info.width + 10) * info.channels;
    const corner = 0;
    const outsidePolygon = (14 * info.width + 14) * info.channels;
    const secondRegion = (3 * info.width + 3) * info.channels;
    assert.deepEqual([...data.subarray(center, center + 3)], [0, 0, 255]);
    assert.deepEqual([...data.subarray(corner, corner + 3)], [255, 0, 0]);
    assert.deepEqual([...data.subarray(outsidePolygon, outsidePolygon + 3)], [255, 0, 0]);
    assert.deepEqual([...data.subarray(secondRegion, secondRegion + 3)], [0, 0, 255]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("AI 자식 프로세스를 취소 신호로 종료한다", async () => {
  const controller = new AbortController();
  const task = runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], () => {}, controller.signal);
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(task, (error) => error.code === "ABORT_ERR");
});
