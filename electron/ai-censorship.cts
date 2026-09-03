const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const sharp = require("sharp");
const { PROJECT_EXTENSIONS } = require("./classification.cjs");
const { cleanedAssetRoot } = require("./project-paths.cjs");

function outputExtension(project, assetPath) {
  if (project.censorshipConfig.outputExtension === "original") {
    const extension = path.extname(assetPath).toLowerCase();
    return PROJECT_EXTENSIONS.has(extension) ? extension : ".png";
  }
  return PROJECT_EXTENSIONS.has(project.censorshipConfig.outputExtension) ? project.censorshipConfig.outputExtension : ".png";
}

function outputPathFor(project, asset) {
  return path.join(cleanedAssetRoot(project), asset.relativePath.replace(/\.[^./\\]+$/, outputExtension(project, asset.savedPath)));
}

function colorChannels(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex || "");
  if (!match) return { r: 255, g: 255, b: 255 };
  return { r: parseInt(match[1].slice(0, 2), 16), g: parseInt(match[1].slice(2, 4), 16), b: parseInt(match[1].slice(4, 6), 16) };
}

async function regionMask(region, opacity, hardness, dilation) {
  const { width, height, polygon } = region;
  const points = polygon.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const stroke = Math.max(0, dilation * 2);
  const body = `<polygon points="${points}" fill="white" stroke="white" stroke-width="${stroke}" stroke-linejoin="round"/>`;
  const feather = Math.max(0, Math.min(width, height) * (1 - hardness / 100) * 0.08);
  let mask = sharp(Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`)).ensureAlpha();
  if (feather > 0.3) mask = mask.blur(feather);
  const alpha = Math.max(0, Math.min(1, opacity / 100));
  return mask.linear([1, 1, 1, alpha], [0, 0, 0, 0]).png().toBuffer();
}

async function censoredPatch(source, region, settings) {
  const { left, top, width, height } = region;
  const extracted = sharp(source).extract({ left, top, width, height });
  let patch;
  if (settings.method === "blur") patch = await extracted.blur(Math.max(2, Math.min(width, height) / 10)).png().toBuffer();
  else if (settings.method === "mosaic") {
    const scale = Math.max(1, Math.round(Math.min(width, height) / 12));
    patch = await extracted.resize(Math.max(1, Math.round(width / scale)), Math.max(1, Math.round(height / scale)), { fit: "fill" }).resize(width, height, { fit: "fill", kernel: "nearest" }).png().toBuffer();
  } else {
    patch = await sharp({ create: { width, height, channels: 4, background: { ...colorChannels(settings.color), alpha: 1 } } }).png().toBuffer();
  }
  const mask = await regionMask(region, settings.opacity, settings.hardness, settings.dilation);
  return sharp(patch).ensureAlpha().composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}

function detectionRegion(detection, imageWidth, imageHeight, dilation) {
  const polygon = Array.isArray(detection?.polygon) ? detection.polygon.map((point) => Array.isArray(point) ? point.map(Number) : []).filter((point) => point.length === 2 && point.every(Number.isFinite)) : [];
  if (polygon.length < 3) throw new Error("탐지 결과에 유효한 영역 마스크가 없습니다.");
  const xs = polygon.map((point) => point[0]);
  const ys = polygon.map((point) => point[1]);
  const left = Math.max(0, Math.floor(Math.min(...xs) - dilation));
  const top = Math.max(0, Math.floor(Math.min(...ys) - dilation));
  const right = Math.min(imageWidth, Math.ceil(Math.max(...xs) + dilation));
  const bottom = Math.min(imageHeight, Math.ceil(Math.max(...ys) + dilation));
  if (right <= left || bottom <= top) throw new Error("탐지 마스크 영역이 이미지 밖에 있습니다.");
  return { left, top, width: right - left, height: bottom - top, polygon: polygon.map(([x, y]) => [x - left, y - top]) };
}

async function renderCensoredAsset(inputPath, outputPath, detections, settings: any = {}) {
  let inputStats;
  try { inputStats = await fs.promises.stat(inputPath); }
  catch (error) { if (error.code === "ENOENT") throw new Error("원본 이미지 파일을 찾을 수 없습니다."); throw error; }
  if (!inputStats.isFile()) throw new Error("원본 이미지 파일을 찾을 수 없습니다.");
  const normalized = {
    method: ["solid", "blur", "mosaic"].includes(settings.method) ? settings.method : "solid",
    color: settings.color || "#ffffff",
    dilation: Math.max(0, Math.min(240, Number(settings.dilation) || 0)),
    hardness: Math.max(0, Math.min(100, Number(settings.hardness) || 0)),
    opacity: Math.max(0, Math.min(100, Number(settings.opacity) || 0))
  };
  const initial = await sharp(inputPath, { animated: false }).rotate().ensureAlpha().png().toBuffer({ resolveWithObject: true });
  const width = initial.info.width;
  const height = initial.info.height;
  const composites = [];
  for (const detection of detections || []) {
    const region = detectionRegion(detection, width, height, normalized.dilation);
    const patch = await censoredPatch(initial.data, region, normalized);
    composites.push({ input: patch, left: region.left, top: region.top });
  }
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  const format = path.extname(outputPath).slice(1).replace("jpg", "jpeg");
  const output = sharp(initial.data);
  if (composites.length) output.composite(composites);
  await output.toFormat(format).toFile(outputPath);
  return outputPath;
}

function cancellationError() {
  const error = new Error("AI 검열 작업이 취소되었습니다.") as Error & { code?: string };
  error.code = "ABORT_ERR";
  return error;
}

function throwIfCancelled(signal) {
  if (signal?.aborted) throw cancellationError();
}

function runProcess(command, args, onMessage, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(cancellationError()); return; }
    const child = spawn(command, args, { windowsHide: true });
    let pending = "";
    let errors = "";
    let settled = false;
    let forceTimer = null;
    const settle = (callback, value = undefined) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      callback(value);
    };
    const abort = () => {
      if (child.exitCode === null) {
        try { child.kill(); } catch {}
        forceTimer = setTimeout(() => { try { if (child.exitCode === null) child.kill("SIGKILL"); } catch {} }, 2000);
        forceTimer.unref?.();
      }
      settle(reject, cancellationError());
    };
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines.filter(Boolean)) {
        try {
          const message = JSON.parse(line);
          if (message.type === "fatal") errors += `${message.error}\n`;
          else onMessage(message);
        } catch { errors += `${line}\n`; }
      }
    });
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.on("error", (error) => settle(reject, error));
    child.on("close", (code) => {
      if (forceTimer) clearTimeout(forceTimer);
      if (signal?.aborted) settle(reject, cancellationError());
      else if (code === 0) settle(resolve);
      else settle(reject, new Error(errors.trim() || "AI 모델 실행에 실패했습니다."));
    });
  });
}

async function runWorker(jobPath, onMessage, signal, workerPath = "") {
  if (workerPath) {
    let workerStats;
    try { workerStats = await fs.promises.stat(workerPath); }
    catch (error) { if (error.code === "ENOENT") throw new Error("패키지에 포함된 AI 실행 파일을 찾을 수 없습니다."); throw error; }
    if (!workerStats.isFile()) throw new Error("패키지에 포함된 AI 실행 파일이 올바르지 않습니다.");
    return runProcess(workerPath, [jobPath], onMessage, signal);
  }
  const script = path.join(__dirname, "..", "ai-runtime", "worker.py");
  try { return await runProcess("py", ["-3", script, jobPath], onMessage, signal); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    try { return await runProcess("python", [script, jobPath], onMessage, signal); }
    catch (fallbackError) {
      if (fallbackError.code === "ENOENT") throw new Error("Python을 찾을 수 없습니다. Python과 PyTorch를 설치해 주세요.");
      throw fallbackError;
    }
  }
}

async function validatedModelPath(modelPathValue) {
  const modelPath = path.resolve(String(modelPathValue || ""));
  let modelStats;
  try { modelStats = await fs.promises.stat(modelPath); }
  catch (error) { if (error.code === "ENOENT") throw new Error("사용할 수 있는 .pt 모델 파일을 지정해 주세요."); throw error; }
  if (path.extname(modelPath).toLowerCase() !== ".pt" || !modelStats.isFile()) throw new Error("사용할 수 있는 .pt 모델 파일을 지정해 주세요.");
  return modelPath;
}

async function inspectAiModel(modelPathValue, workerPath = "") {
  const modelPath = await validatedModelPath(modelPathValue);
  const jobPath = path.join(os.tmpdir(), `aaa-ai-model-inspect-${process.pid}-${Date.now()}.json`);
  let modelInfo = null;
  await fs.promises.writeFile(jobPath, JSON.stringify({ action: "inspect", modelPath }), "utf8");
  try {
    await runWorker(jobPath, (message) => {
      if (message.type === "model-info") modelInfo = message;
    }, undefined, workerPath);
    if (!modelInfo || !Array.isArray(modelInfo.classes)) throw new Error("모델에서 학습 클래스 정보를 받지 못했습니다.");
    return modelInfo;
  } finally {
    await fs.promises.unlink(jobPath).catch(() => {});
  }
}

function normalizedCensorTargets(value) {
  return [...new Set(Array.isArray(value) ? value.map((target) => String(target).trim()).filter(Boolean) : [])];
}

async function runAiCensorship({ project, assets, settings, onProgress, onResult, signal, workerPath = "", resolveOutputPath = null }) {
  throwIfCancelled(signal);
  const targets = normalizedCensorTargets(settings.targets);
  if (!targets.length) throw new Error("검열 대상을 하나 이상 선택해 주세요.");
  const modelPath = await validatedModelPath(settings.modelPath);
  const jobPath = path.join(os.tmpdir(), `aaa-ai-censorship-${process.pid}-${Date.now()}.json`);
  const results = new Map();
  const total = assets.length;
  await fs.promises.writeFile(jobPath, JSON.stringify({ modelPath, targets, confidence: Number(settings.confidence) / 100, imageSize: settings.imageSize, files: assets.map((asset) => ({ path: asset.savedPath })) }), "utf8");
  try {
    onProgress({ stage: "loading", completed: 0, total, message: "AI 모델 불러오는 중" });
    await runWorker(jobPath, (message) => {
      if (message.type === "loaded") onProgress({ stage: "detecting", completed: 0, total, message: `${message.model} 모델 분석 준비 완료` });
      if (message.type === "result") {
        results.set(message.index, message);
        onProgress({ stage: "detecting", completed: results.size, total, message: `이미지 분석 중 (${results.size}/${total})` });
      }
    }, signal, workerPath);
    let succeeded = 0;
    let failed = 0;
    for (let index = 0; index < assets.length; index += 1) {
      throwIfCancelled(signal);
      const asset = assets[index];
      const result = results.get(index);
      try {
        if (!result || result.error) throw new Error(result?.error || "모델 결과를 받지 못했습니다.");
        const outputPath = resolveOutputPath ? resolveOutputPath(asset) : outputPathFor(project, asset);
        await renderCensoredAsset(asset.savedPath, outputPath, result.detections, settings);
        throwIfCancelled(signal);
        await onResult(asset, "auto", outputPath, "", result.detections.length);
        succeeded += 1;
      } catch (error) {
        await onResult(asset, "failed", undefined, error.message);
        failed += 1;
      }
      onProgress({ stage: "saving", completed: index + 1, total, message: `검열 이미지 저장 중 (${index + 1}/${total})` });
    }
    return { total, succeeded, failed };
  } finally {
    await fs.promises.unlink(jobPath).catch(() => {});
  }
}

module.exports = { outputPathFor, renderCensoredAsset, inspectAiModel, normalizedCensorTargets, runAiCensorship, runProcess };
