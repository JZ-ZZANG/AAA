const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("오프라인 Twemoji 목록과 SVG 파일 구성이 일치한다", () => {
  const projectRoot = path.resolve(__dirname, "..");
  const svgRoot = path.join(projectRoot, "public", "vendor", "twemoji", "assets", "svg");
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "src", "renderer", "generated", "twemoji-manifest.json"), "utf8"));
  const svgIds = fs.readdirSync(svgRoot).filter((name) => name.endsWith(".svg")).map((name) => name.slice(0, -4));

  assert.equal(manifest.length, svgIds.length);
  assert.ok(manifest.includes("1f600"));
  assert.ok(manifest.includes("1f44d-1f3fd"));
  assert.deepEqual(new Set(manifest), new Set(svgIds));
});
