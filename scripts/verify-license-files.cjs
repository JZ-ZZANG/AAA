const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const requiredFiles = [
  ["LICENSE", "GNU AGPL v3 원문"],
  ["licenses/ULTRALYTICS-AGPL-3.0.txt", "Ultralytics AGPL 원문"],
  ["licenses/TWEMOJI-MIT.txt", "Twemoji MIT 원문"],
  ["licenses/TWEMOJI-CC-BY-4.0.txt", "Twemoji CC BY 4.0 원문"]
];

const missing = requiredFiles.filter(([relativePath]) => {
  const filePath = path.join(projectRoot, relativePath);
  return !fs.existsSync(filePath) || fs.readFileSync(filePath, "utf8").trim().length < 100;
});

if (missing.length) {
  const list = missing.map(([relativePath, description]) => `- ${relativePath}: ${description}`).join("\n");
  throw new Error(`배포 전에 라이선스 원문을 입력해 주세요.\n${list}`);
}

console.log("배포용 라이선스 문서 확인 완료");
