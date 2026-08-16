const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const sharp = require("sharp");
const { IMAGE_EXTENSIONS } = require("./classification.cjs");

const MAX_TRACKS = 3;
const MAX_RAW_ANIMATION_BYTES = 512 * 1024 * 1024;

function validImagePath(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("이미지 경로가 올바르지 않습니다.");
  const resolved = path.resolve(value);
  if (!IMAGE_EXTENSIONS.has(path.extname(resolved).toLowerCase())) throw new Error("지원하지 않는 이미지 형식입니다.");
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error("이미지 파일을 찾을 수 없습니다.");
  return resolved;
}

function duration(value) {
  const number = Number(value);
  return Math.max(0, Math.min(65535, Math.round(Number.isFinite(number) ? number : 500)));
}

function timelineSegments(tracks) {
  const prepared = tracks.map((track) => {
    let start = 0;
    return { frames: track.frames.map((frame) => { const delay = duration(frame.duration); const timed = { ...frame, start, end: start + delay }; start += delay; return timed; }), end: start };
  });
  const boundaries = new Set([0]);
  prepared.forEach((track) => track.frames.forEach((frame) => boundaries.add(frame.end)));
  const times = [...boundaries].sort((left, right) => left - right);
  return times.slice(0, -1).map((start, index) => ({
    delay: times[index + 1] - start,
    paths: prepared.map((track) => track.frames.find((frame) => frame.start <= start && start < frame.end)?.path || null)
  })).filter((segment) => segment.delay > 0 && segment.paths.some(Boolean));
}

async function fitImage(imagePath, width, height) {
  return sharp(validImagePath(imagePath), { animated: false }).rotate().resize(width, height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).ensureAlpha().png().toBuffer();
}

async function renderSegment(paths, width, height) {
  const composites = [];
  for (const imagePath of [...paths].reverse()) if (imagePath) composites.push({ input: await fitImage(imagePath, width, height), gravity: "center" });
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(composites).raw().toBuffer();
}

async function createAnimation({ tracks, format = "webp", quality = 100 }, outputPath) {
  const validTracks = Array.isArray(tracks) ? tracks.map((track) => ({ frames: Array.isArray(track?.frames) ? track.frames.filter((frame) => frame?.path) : [] })) : [];
  if (validTracks.length > MAX_TRACKS) throw new Error(`레이어는 최대 ${MAX_TRACKS}개까지 사용할 수 있습니다.`);
  const firstPath = [...validTracks].reverse().flatMap((track) => track.frames).find((frame) => frame.path)?.path;
  if (!firstPath) throw new Error("이미지를 한 장 이상 추가해 주세요.");
  if (!new Set(["gif", "webp"]).has(format)) throw new Error("출력 형식이 올바르지 않습니다.");
  const metadata = await sharp(validImagePath(firstPath), { animated: false }).rotate().metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) throw new Error("기준 이미지 크기를 확인할 수 없습니다.");
  const segments = timelineSegments(validTracks);
  if (!segments.length) throw new Error("전체 재생 시간이 0ms입니다. 프레임 하나 이상의 시간을 1ms 이상으로 설정해 주세요.");
  const rawAnimationBytes = width * height * 4 * segments.length;
  if (!Number.isSafeInteger(rawAnimationBytes) || rawAnimationBytes > MAX_RAW_ANIMATION_BYTES) {
    throw new Error("이미지 크기와 프레임 수가 너무 커서 메모리가 과도하게 사용될 수 있습니다. 이미지 크기나 프레임 수를 줄여 주세요.");
  }
  const resolvedQuality = Math.max(1, Math.min(100, Math.round(Number(quality) || 100)));
  const rendered = [];
  for (const segment of segments) rendered.push(await renderSegment(segment.paths, width, height));
  const animation = sharp(Buffer.concat(rendered), { raw: { width, height: height * rendered.length, channels: 4, pageHeight: height } });
  const delays = segments.map((segment) => segment.delay);
  if (format === "webp") await animation.webp({ delay: delays, loop: 0, quality: resolvedQuality, alphaQuality: resolvedQuality, effort: 4 }).toFile(outputPath);
  else await animation.gif({ delay: delays, loop: 0, colours: Math.max(2, Math.round(2 + resolvedQuality * 2.54)), effort: 7 }).toFile(outputPath);
  return { outputPath, width, height, frames: rendered.length, durationMs: delays.reduce((total, delay) => total + delay, 0), format, quality: resolvedQuality };
}

async function createAnimationSafely(input, outputPath) {
  const destination = path.resolve(outputPath);
  const directory = path.dirname(destination);
  const extension = path.extname(destination);
  const unique = `${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  const temporaryPath = path.join(directory, `.${path.basename(destination, extension)}-${unique}.tmp${extension}`);
  const backupPath = path.join(directory, `.${path.basename(destination, extension)}-${unique}.bak${extension}`);
  let backupCreated = false;

  try {
    const result = await createAnimation(input, temporaryPath);
    if (fs.existsSync(destination)) {
      if (!fs.statSync(destination).isFile()) throw new Error("저장 위치에 같은 이름의 폴더가 있습니다.");
      await fs.promises.rename(destination, backupPath);
      backupCreated = true;
    }
    try {
      await fs.promises.rename(temporaryPath, destination);
    } catch (error) {
      if (backupCreated) {
        try { await fs.promises.rename(backupPath, destination); backupCreated = false; }
        catch (restoreError) { throw new AggregateError([error, restoreError], "새 파일 저장과 기존 파일 복원에 실패했습니다."); }
      }
      throw error;
    }
    if (backupCreated) {
      await fs.promises.unlink(backupPath);
      backupCreated = false;
    }
    return { ...result, outputPath: destination };
  } finally {
    await fs.promises.unlink(temporaryPath).catch(() => {});
    if (backupCreated && fs.existsSync(destination)) await fs.promises.unlink(backupPath).catch(() => {});
  }
}

async function saveGeneratedAnimation(sourcePath, outputPath) {
  const source = path.resolve(sourcePath);
  const destination = path.resolve(outputPath);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error("저장할 움짤 임시 파일을 찾을 수 없습니다.");
  const directory = path.dirname(destination);
  const extension = path.extname(destination);
  const unique = `${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  const temporaryPath = path.join(directory, `.${path.basename(destination, extension)}-${unique}.tmp${extension}`);
  const backupPath = path.join(directory, `.${path.basename(destination, extension)}-${unique}.bak${extension}`);
  let backupCreated = false;
  try {
    await fs.promises.copyFile(source, temporaryPath, fs.constants.COPYFILE_EXCL);
    if (fs.existsSync(destination)) {
      if (!fs.statSync(destination).isFile()) throw new Error("저장 위치에 같은 이름의 폴더가 있습니다.");
      await fs.promises.rename(destination, backupPath);
      backupCreated = true;
    }
    try {
      await fs.promises.rename(temporaryPath, destination);
    } catch (error) {
      if (backupCreated) {
        try { await fs.promises.rename(backupPath, destination); backupCreated = false; }
        catch (restoreError) { throw new AggregateError([error, restoreError], "새 파일 저장과 기존 파일 복원에 실패했습니다."); }
      }
      throw error;
    }
    if (backupCreated) {
      await fs.promises.unlink(backupPath);
      backupCreated = false;
    }
    return destination;
  } finally {
    await fs.promises.unlink(temporaryPath).catch(() => {});
    if (backupCreated && fs.existsSync(destination)) await fs.promises.unlink(backupPath).catch(() => {});
  }
}

module.exports = { createAnimation, createAnimationSafely, saveGeneratedAnimation, timelineSegments, MAX_TRACKS, MAX_RAW_ANIMATION_BYTES };
