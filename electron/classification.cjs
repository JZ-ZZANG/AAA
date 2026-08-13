const fs = require("node:fs");
const path = require("node:path");
const { originAssetRoot } = require("./project-paths.cjs");

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".bmp"]);
const PROJECT_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif"]);
const INVALID_PART = /[<>:"|?*\x00-\x1f]/;
const RESERVED_PART = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function renderRelativePath(project, selections, sourcePath) {
  const sourceExtension = path.extname(sourcePath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(sourceExtension)) throw new Error("지원하지 않는 이미지 형식입니다.");
  const extension = sourceExtension;
  if (!project.pathTemplate.trim()) throw new Error("저장 경로 규칙을 먼저 설정해 주세요.");

  const selectedValues = new Map();
  const referencedTagIds = new Set([...project.pathTemplate.matchAll(/\{tag:([^}]+)\}/g)].map((match) => match[1]));
  project.tags.filter((tag) => referencedTagIds.has(tag.id)).forEach((tag) => {
    const selected = tag.values.find((item) => item.id === selections[tag.id]);
    if (!selected) throw new Error(`${tag.name} 값을 선택해 주세요.`);
    selectedValues.set(tag.id, selected.value);
  });

  let rendered = project.pathTemplate.replaceAll("{extension}", extension.slice(1));
  selectedValues.forEach((value, tagId) => {
    rendered = rendered.replaceAll(`{tag:${tagId}}`, value);
  });
  if (/\{tag:[^}]+\}/.test(rendered)) throw new Error("경로 규칙에 존재하지 않는 분류 기준이 포함되어 있습니다.");

  const normalizedInput = rendered.replaceAll("\\", "/");
  if (normalizedInput.startsWith("/") || /^[a-zA-Z]:/.test(normalizedInput)) throw new Error("상대 경로만 사용할 수 있습니다.");
  const parts = normalizedInput.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || INVALID_PART.test(part) || RESERVED_PART.test(part) || /[. ]$/.test(part))) {
    throw new Error("경로에 사용할 수 없는 폴더명 또는 파일명이 있습니다.");
  }
  if (!path.extname(parts.at(-1))) throw new Error("경로 규칙의 파일명에 {extension}을 포함해 주세요.");
  return parts.join(path.sep);
}

function resolveDestination(saveRoot, relativePath) {
  const root = path.resolve(saveRoot);
  const destination = path.resolve(root, relativePath);
  const relation = path.relative(root, destination);
  if (!relation || relation.startsWith("..") || path.isAbsolute(relation)) throw new Error("저장 위치 밖의 경로는 사용할 수 없습니다.");
  return destination;
}

async function copyClassifiedAsset({ project, sourcePath, selections, overwrite = false }) {
  const source = path.resolve(sourcePath);
  let sourceStats;
  try { sourceStats = await fs.promises.stat(source); }
  catch (error) { if (error.code === "ENOENT") throw new Error("원본 이미지 파일을 찾을 수 없습니다."); throw error; }
  if (!sourceStats.isFile()) throw new Error("원본 이미지 파일을 찾을 수 없습니다.");
  const relativePath = renderRelativePath(project, selections, source);
  const destination = resolveDestination(originAssetRoot(project), relativePath);
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  try { await fs.promises.copyFile(source, destination, overwrite ? 0 : fs.constants.COPYFILE_EXCL); }
  catch (error) { if (error.code === "EEXIST" && !overwrite) return { collision: true, relativePath, destination }; throw error; }
  const stats = await fs.promises.stat(destination);
  return { collision: false, relativePath, destination, sourceName: path.basename(source), fileSize: stats.size, modifiedAt: stats.mtimeMs };
}

module.exports = { copyClassifiedAsset, renderRelativePath, IMAGE_EXTENSIONS, PROJECT_EXTENSIONS };
