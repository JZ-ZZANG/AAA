const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { scanStandaloneFolder, standaloneOutputPath, planStandaloneOutputs } = require("../electron-dist/standalone-ai-censorship.cjs");

async function temporaryDirectory() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), "aaa-standalone-ai-test-"));
}

test("독립 AI 검열 폴더에서 이미지 경로 정보만 재귀적으로 수집한다", async () => {
  const root = await temporaryDirectory();
  try {
    await fs.promises.mkdir(path.join(root, "nested"));
    await fs.promises.writeFile(path.join(root, "first.png"), "image-one");
    await fs.promises.writeFile(path.join(root, "nested", "second.webp"), "image-two");
    await fs.promises.writeFile(path.join(root, "ignored.txt"), "text");
    const result = await scanStandaloneFolder(root);
    assert.equal(result.rootPath, path.resolve(root));
    assert.deepEqual(result.assets.map((asset) => asset.relativePath.replaceAll("\\", "/")), ["first.png", "nested/second.webp"]);
    assert.deepEqual(result.assets.map((asset) => asset.fileSize), [9, 9]);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("독립 AI 검열 결과는 상대 폴더 구조와 선택한 확장자를 유지한다", async () => {
  const outputRoot = path.join(os.tmpdir(), "aaa-standalone-output");
  const asset = { savedPath: path.join(os.tmpdir(), "source", "image.bmp"), relativePath: "characters/hero/image.bmp" };
  assert.equal(standaloneOutputPath(outputRoot, asset, "original"), path.join(outputRoot, "characters", "hero", "image.png"));
  assert.equal(standaloneOutputPath(outputRoot, asset, ".webp"), path.join(outputRoot, "characters", "hero", "image.webp"));
});

test("독립 AI 검열 결과가 출력 폴더 밖으로 나가는 상대 경로를 거부한다", async () => {
  assert.throws(() => standaloneOutputPath(path.join(os.tmpdir(), "aaa-output"), { savedPath: "image.png", relativePath: "../outside.png" }, ".png"), /상대 경로/);
});

test("독립 AI 검열 출력 파일이 중복되면 번호를 붙여 이름을 바꾼다", async () => {
  const outputRoot = path.join(os.tmpdir(), "aaa-standalone-output-plan");
  const assets = [
    { id: "first", savedPath: path.join(os.tmpdir(), "source", "first.jpg"), relativePath: "image.jpg" },
    { id: "second", savedPath: path.join(os.tmpdir(), "source", "second.webp"), relativePath: "image.webp" }
  ];
  const existing = new Set([path.join(outputRoot, "image.png")]);
  const plan = await planStandaloneOutputs(outputRoot, assets, ".png", "rename", async (target) => existing.has(target), "win32");
  assert.equal(plan.outputPaths.get("first"), path.join(outputRoot, "image (2).png"));
  assert.equal(plan.outputPaths.get("second"), path.join(outputRoot, "image (3).png"));
  assert.equal(plan.skipped.length, 0);
});

test("독립 AI 검열 출력 파일이 중복되면 선택에 따라 건너뛴다", async () => {
  const outputRoot = path.join(os.tmpdir(), "aaa-standalone-output-skip");
  const asset = { id: "image", savedPath: path.join(os.tmpdir(), "source", "image.png"), relativePath: "image.png" };
  const plan = await planStandaloneOutputs(outputRoot, [asset], ".png", "skip", async () => true);
  assert.deepEqual(plan.assets, []);
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.outputPaths.size, 0);
});

test("독립 AI 검열 덮어쓰기는 기존 출력 경로를 그대로 사용한다", async () => {
  const outputRoot = path.join(os.tmpdir(), "aaa-standalone-output-overwrite");
  const asset = { id: "image", savedPath: path.join(os.tmpdir(), "source", "image.png"), relativePath: "image.png" };
  const plan = await planStandaloneOutputs(outputRoot, [asset], ".png", "overwrite", async () => true);
  assert.equal(plan.outputPaths.get("image"), path.join(outputRoot, "image.png"));
  assert.equal(plan.assets.length, 1);
});
