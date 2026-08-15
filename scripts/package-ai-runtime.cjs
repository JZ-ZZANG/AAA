const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const runtimeRoot = path.join(projectRoot, "ai-runtime");
const workerRoot = path.join(projectRoot, "python-dist", "aaa-ai-worker");
const outputRoot = path.join(projectRoot, "ai-release");
const sourceManifest = path.join(runtimeRoot, "runtime.json");
const workerManifest = path.join(workerRoot, "runtime.json");
const projectLicense = path.join(projectRoot, "LICENSE");
const ultralyticsLicense = path.join(projectRoot, "licenses", "ULTRALYTICS-AGPL-3.0.txt");
const workerLicense = path.join(workerRoot, "LICENSE");
const workerLicenseRoot = path.join(workerRoot, "licenses");
const workerUltralyticsLicense = path.join(workerLicenseRoot, "ULTRALYTICS-AGPL-3.0.txt");
for (const [filePath, label] of [[projectLicense, "LICENSE"], [ultralyticsLicense, "Ultralytics 라이선스"]]) {
  if (!fs.existsSync(filePath) || fs.readFileSync(filePath, "utf8").trim().length < 100) throw new Error(`${label} 원문을 먼저 입력해 주세요.`);
}
const manifest = JSON.parse(fs.readFileSync(sourceManifest, "utf8"));
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.runtimeVersion || "")) throw new Error("ai-runtime/runtime.json의 버전이 올바르지 않습니다.");
if (!fs.existsSync(path.join(workerRoot, "aaa-ai-worker.exe"))) throw new Error("먼저 npm run build:ai를 실행해 주세요.");

fs.mkdirSync(outputRoot, { recursive: true });
const baseName = `AAA-AI-Runtime-${manifest.runtimeVersion}`;
const archivePath = path.join(outputRoot, `${baseName}.zip`);
const checksumPath = path.join(outputRoot, `${baseName}.sha256`);
fs.rmSync(archivePath, { force: true });
if (fs.existsSync(workerLicense) || fs.existsSync(workerLicenseRoot)) throw new Error("AI 빌드 결과에 예약된 라이선스 경로가 이미 존재합니다.");
fs.copyFileSync(sourceManifest, workerManifest);
fs.copyFileSync(projectLicense, workerLicense);
fs.mkdirSync(workerLicenseRoot, { recursive: true });
fs.copyFileSync(ultralyticsLicense, workerUltralyticsLicense);
try {
  const result = spawnSync("tar", ["-a", "-c", "-f", archivePath, "-C", workerRoot, "."], { stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`AI 실행 환경 압축에 실패했습니다. (${result.status})`);
} finally {
  fs.rmSync(workerManifest, { force: true });
  fs.rmSync(workerLicense, { force: true });
  fs.rmSync(workerLicenseRoot, { recursive: true, force: true });
}
const hash = crypto.createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex");
fs.writeFileSync(checksumPath, `${hash}  ${path.basename(archivePath)}\n`, "utf8");
fs.copyFileSync(sourceManifest, path.join(outputRoot, "runtime.json"));
console.log(`AI 실행 환경 패키지 생성: ${archivePath}`);
