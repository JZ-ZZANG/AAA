const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const sourceDirectory = path.join(projectRoot, "public", "vendor", "twemoji", "assets", "svg");
const outputDirectory = path.join(projectRoot, "src", "renderer", "generated");
const outputPath = path.join(outputDirectory, "twemoji-manifest.json");

if (!fs.existsSync(sourceDirectory)) throw new Error(`Twemoji SVG 폴더를 찾을 수 없습니다: ${sourceDirectory}`);

const ids = fs.readdirSync(sourceDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /^[0-9a-f-]+\.svg$/i.test(entry.name))
  .map((entry) => entry.name.slice(0, -4).toLowerCase())
  .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));

if (!ids.length) throw new Error("Twemoji SVG 파일이 없습니다.");

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(ids)}\n`, "utf8");
console.log(`Twemoji 목록 생성: ${ids.length}개`);
