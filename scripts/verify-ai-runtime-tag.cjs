const fs = require("node:fs");
const path = require("node:path");

const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "ai-runtime", "runtime.json"), "utf8"));
const tag = process.env.GITHUB_REF_NAME || process.argv[2] || "";
if (tag !== `ai-v${manifest.runtimeVersion}`) {
  throw new Error(`AI Runtime 태그 ${tag || "(없음)"}와 runtime.json 버전 ${manifest.runtimeVersion}이 일치하지 않습니다.`);
}
console.log(`AI Runtime 버전 확인: ${manifest.runtimeVersion}`);
