const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { AiRuntimeManager, compareVersions, safeArchiveEntry, validVersion } = require("../electron/ai-runtime.cjs");

test("AI Runtime 버전을 비교한다", () => {
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.ok(compareVersions("1.1.0", "1.0.9") > 0);
  assert.ok(compareVersions("1.0.0", "2.0.0") < 0);
  assert.equal(validVersion("1.0.0"), true);
  assert.equal(validVersion("latest"), false);
});

test("AI Runtime 압축 파일의 외부 경로를 거부한다", () => {
  assert.equal(safeArchiveEntry("_internal/torch.dll"), true);
  assert.equal(safeArchiveEntry("aaa-ai-worker.exe"), true);
  assert.equal(safeArchiveEntry("../outside.exe"), false);
  assert.equal(safeArchiveEntry("folder/../../outside.exe"), false);
  assert.equal(safeArchiveEntry("C:\\outside.exe"), false);
  assert.equal(safeArchiveEntry("/outside.exe"), false);
});

test("AI Runtime ZIP을 버전 폴더에 설치하고 현재 버전으로 지정한다", async (context) => {
  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "aaa-ai-runtime-"));
  context.after(() => fs.promises.rm(temporaryRoot, { recursive: true, force: true }));
  const source = path.join(temporaryRoot, "source");
  const runtimeRoot = path.join(temporaryRoot, "installed-runtime");
  const archive = path.join(temporaryRoot, "runtime.zip");
  await fs.promises.mkdir(source);
  await fs.promises.writeFile(path.join(source, "aaa-ai-worker.exe"), "worker");
  await fs.promises.writeFile(path.join(source, "runtime.json"), JSON.stringify({ runtimeVersion: "1.2.3", protocolVersion: 1, entry: "aaa-ai-worker.exe" }));
  const packed = spawnSync("tar", ["-a", "-c", "-f", archive, "-C", source, "."], { windowsHide: true });
  assert.equal(packed.status, 0, packed.stderr?.toString());
  const manager = new AiRuntimeManager({ getPath: () => temporaryRoot }, { rootPath: runtimeRoot, requestPath: path.join(temporaryRoot, "request") });
  const installed = await manager.installArchive(archive);
  assert.equal(installed.installed, true);
  assert.equal(installed.version, "1.2.3");
  assert.equal(await fs.promises.readFile(installed.workerPath, "utf8"), "worker");
  const reinstalled = await manager.installArchive(archive);
  assert.equal(reinstalled.installed, true);
  assert.equal(reinstalled.version, "1.2.3");
});
