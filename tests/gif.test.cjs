const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { createAnimation, createAnimationSafely, saveGeneratedAnimation, timelineSegments, MAX_TRACKS } = require("../electron/gif.cjs");

sharp.cache(false);

test("독립 타임라인의 프레임 시간에 맞춰 레이어를 합성한다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaa-gif-"));
  try {
    const first = path.join(root, "first.png");
    const second = path.join(root, "second.png");
    const overlay = path.join(root, "overlay.png");
    const output = path.join(root, "animation.gif");
    const webpOutput = path.join(root, "animation.webp");
    await sharp({ create: { width: 8, height: 6, channels: 4, background: "red" } }).png().toFile(first);
    await sharp({ create: { width: 8, height: 6, channels: 4, background: "blue" } }).png().toFile(second);
    await sharp({ create: { width: 8, height: 6, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 0.5 } } }).png().toFile(overlay);
    const frames = [{ path: first, duration: 120 }, { path: second, duration: 340 }];
    const tracks = [{ frames: [{ path: overlay, duration: 460 }] }, { frames }];
    const segments = timelineSegments(tracks);
    assert.deepEqual(segments.map((segment) => segment.delay), [120, 340]);
    assert.deepEqual(segments[0].paths, [overlay, first]);
    assert.deepEqual(segments[1].paths, [overlay, second]);

    const result = await createAnimation({ tracks, format: "gif", quality: 75 }, output);
    const metadata = await sharp(output, { animated: true }).metadata();
    assert.equal(result.frames, 2);
    assert.equal(result.durationMs, 460);
    assert.equal(metadata.pages, 2);
    assert.deepEqual(metadata.delay, [120, 340]);
    fs.writeFileSync(webpOutput, "기존 파일");
    const safeResult = await createAnimationSafely({ tracks, format: "webp", quality: 100 }, webpOutput);
    const webpMetadata = await sharp(webpOutput, { animated: true }).metadata();
    assert.equal(safeResult.outputPath, webpOutput);
    assert.equal(webpMetadata.format, "webp");
    assert.equal(webpMetadata.pages, 2);
    const savedCopy = path.join(root, "saved-copy.webp");
    fs.writeFileSync(savedCopy, "기존 파일");
    assert.equal(await saveGeneratedAnimation(webpOutput, savedCopy), savedCopy);
    assert.equal((await sharp(savedCopy, { animated: true }).metadata()).pages, 2);
    assert.equal(fs.existsSync(webpOutput), true);
    assert.deepEqual(fs.readdirSync(root).filter((name) => name.includes(".tmp") || name.includes(".bak")), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("레이어를 최대 3개로 제한한다", async () => {
  const tracks = Array.from({ length: MAX_TRACKS + 1 }, () => ({ frames: [] }));
  await assert.rejects(
    createAnimation({ tracks }, "unused.webp"),
    /레이어는 최대 3개/
  );
});

test("0ms 프레임은 허용하고 재생 시간 계산에서 제외한다", () => {
  assert.deepEqual(timelineSegments([{ frames: [{ path: "skipped.png", duration: 0 }, { path: "shown.png", duration: 100 }] }]), [{ delay: 100, paths: ["shown.png"] }]);
});
