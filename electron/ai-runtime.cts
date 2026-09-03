const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { net } = require("electron");

const RUNTIME_PROTOCOL_VERSION = 2;
const RELEASES_API = "https://api.github.com/repos/JZ-ZZANG/AAA/releases?per_page=40";
const RUNTIME_TAG_PREFIX = "ai-v";
const CURRENT_FILE = "current.json";
const MANIFEST_FILE = "runtime.json";
const WORKER_FILE = "aaa-ai-worker.exe";

function validVersion(value) {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
}

function versionParts(value) {
  return String(value || "").split(/[.+-]/).slice(0, 3).map((part) => Number(part) || 0);
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function safeArchiveEntry(entryValue) {
  const entry = String(entryValue || "").trim().replaceAll("\\", "/");
  if (!entry || entry.includes("\0") || entry.startsWith("/") || /^[A-Za-z]:/.test(entry)) return false;
  return !entry.split("/").some((part) => part === "..");
}

function runtimeRootPath(app) {
  const localRoot = process.env.LOCALAPPDATA || path.dirname(app.getPath("userData"));
  return path.resolve(localRoot, "JZ-ZZANG", "AAA-AI-Runtime");
}

function assertSafeRuntimeRoot(rootPath) {
  const resolved = path.resolve(rootPath);
  if (resolved === path.parse(resolved).root || resolved.length < 12) throw new Error("AI 검열 기능 경로가 올바르지 않습니다.");
  return resolved;
}

async function readJson(filePath) {
  return JSON.parse(await fs.promises.readFile(filePath, "utf8"));
}

function runCommand(command, args, options: any = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    let output = "";
    let errors = "";
    child.stdout?.on("data", (chunk) => { output += chunk; });
    child.stderr?.on("data", (chunk) => { errors += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(errors.trim() || `${command} 실행에 실패했습니다.`)));
  });
}

async function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  stream.on("data", (chunk) => hash.update(chunk));
  await once(stream, "end");
  return hash.digest("hex");
}

async function fetchJson(url) {
  const response = await net.fetch(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": "AAA" } });
  if (!response.ok) throw new Error(`GitHub에서 AI 검열 기능 정보를 확인하지 못했습니다. (${response.status})`);
  return await response.json() as any[];
}

async function downloadFile(url, destination, onProgress, signal) {
  const response = await net.fetch(url, { signal, headers: { Accept: "application/octet-stream", "User-Agent": "AAA" } });
  if (!response.ok || !response.body) throw new Error(`AI 검열 기능을 다운로드하지 못했습니다. (${response.status})`);
  const total = Number(response.headers.get("content-length")) || 0;
  let completed = 0;
  const tracker = new Transform({
    transform(chunk, _encoding, callback) {
      completed += chunk.length;
      onProgress?.({ stage: "downloading", completed, total, percent: total ? Math.round(completed / total * 100) : 0, message: "AI 검열 기능 다운로드 중" });
      callback(null, chunk);
    }
  });
  await pipeline(Readable.fromWeb(response.body), tracker, fs.createWriteStream(destination), { signal });
}

async function validateExtractedTree(rootPath) {
  let entries = 0;
  let bytes = 0;
  const queue = [rootPath];
  while (queue.length) {
    const current = queue.pop();
    for (const entry of await fs.promises.readdir(current, { withFileTypes: true })) {
      entries += 1;
      if (entries > 50000) throw new Error("AI 검열 기능 파일이 너무 많습니다.");
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error("AI 검열 기능에 허용되지 않는 링크가 포함되어 있습니다.");
      if (entry.isDirectory()) queue.push(target);
      else if (entry.isFile()) {
        bytes += (await fs.promises.stat(target)).size;
        if (bytes > 4 * 1024 * 1024 * 1024) throw new Error("AI 검열 기능 파일의 크기가 너무 큽니다.");
      }
    }
  }
}

class AiRuntimeManager {
  app: any;
  rootPath: string;
  requestPath: string;
  installController: AbortController | null;

  constructor(app, options: any = {}) {
    this.app = app;
    this.rootPath = assertSafeRuntimeRoot(options.rootPath || runtimeRootPath(app));
    this.requestPath = options.requestPath || path.join(app.getPath("userData"), "install-ai-runtime-requested");
    this.installController = null;
  }

  versionsPath() { return path.join(this.rootPath, "versions"); }
  currentPath() { return path.join(this.rootPath, CURRENT_FILE); }

  async installed() {
    try {
      const current = await readJson(this.currentPath());
      if (!validVersion(current.version)) throw new Error("version");
      const directory = path.join(this.versionsPath(), current.version);
      const manifest = await readJson(path.join(directory, MANIFEST_FILE));
      const workerPath = path.join(directory, WORKER_FILE);
      const worker = await fs.promises.stat(workerPath);
      if (!worker.isFile()) throw new Error("worker");
      return {
        installed: true,
        version: current.version,
        compatible: Number(manifest.protocolVersion) === RUNTIME_PROTOCOL_VERSION,
        available: this.app.isPackaged === false || Number(manifest.protocolVersion) === RUNTIME_PROTOCOL_VERSION,
        workerPath,
        rootPath: this.rootPath
      };
    } catch {
      return { installed: false, version: "", compatible: false, available: this.app.isPackaged === false, workerPath: "", rootPath: this.rootPath };
    }
  }

  installedWorkerPath() {
    try {
      const current = JSON.parse(fs.readFileSync(this.currentPath(), "utf8"));
      if (!validVersion(current.version)) return "";
      const directory = path.join(this.versionsPath(), current.version);
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, MANIFEST_FILE), "utf8"));
      if (Number(manifest.protocolVersion) !== RUNTIME_PROTOCOL_VERSION) return "";
      const workerPath = path.join(directory, WORKER_FILE);
      return fs.statSync(workerPath).isFile() ? workerPath : "";
    } catch { return ""; }
  }

  async consumeInstallRequest() {
    try {
      await fs.promises.unlink(this.requestPath);
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }

  async latest() {
    const releases = await fetchJson(RELEASES_API);
    const release = releases.find((item) => !item.draft && String(item.tag_name || "").startsWith(RUNTIME_TAG_PREFIX));
    if (!release) throw new Error("배포된 AI 검열 기능을 찾을 수 없습니다.");
    const version = String(release.tag_name).slice(RUNTIME_TAG_PREFIX.length);
    if (!validVersion(version)) throw new Error("AI 검열 기능 릴리스 버전이 올바르지 않습니다.");
    const archive = release.assets?.find((asset) => asset.name === `AAA-AI-Runtime-${version}.zip`);
    const checksum = release.assets?.find((asset) => asset.name === `AAA-AI-Runtime-${version}.sha256`);
    if (!archive || !checksum) throw new Error("AI 검열 기능 릴리스 파일이 완전하지 않습니다.");
    const current = await this.installed();
    return {
      ...current,
      latestVersion: version,
      updateAvailable: !current.installed || compareVersions(current.version, version) < 0,
      downloadSize: Number(archive.size) || 0,
      archiveUrl: archive.browser_download_url,
      checksumUrl: checksum.browser_download_url
    };
  }

  async installArchive(archivePath, onProgress, expected: any = {}) {
    const list = await runCommand("tar", ["-tf", archivePath]);
    const entries = list.split(/\r?\n/).filter(Boolean);
    if (!entries.length || entries.some((entry) => !safeArchiveEntry(entry))) throw new Error("AI 검열 기능 압축 파일에 안전하지 않은 경로가 포함되어 있습니다.");
    const temporary = path.join(this.versionsPath(), `.installing-${crypto.randomUUID()}`);
    await fs.promises.mkdir(temporary, { recursive: true });
    try {
      onProgress?.({ stage: "extracting", completed: 0, total: 0, percent: 0, message: "AI 검열 기능 설치 중" });
      await runCommand("tar", ["-xf", archivePath, "-C", temporary]);
      await validateExtractedTree(temporary);
      const manifest = await readJson(path.join(temporary, MANIFEST_FILE));
      if (!validVersion(manifest.runtimeVersion) || Number(manifest.protocolVersion) !== RUNTIME_PROTOCOL_VERSION) throw new Error("호환되지 않는 AI 검열 기능입니다.");
      if (expected.version && manifest.runtimeVersion !== expected.version) throw new Error("AI 검열 기능의 버전이 릴리스 정보와 일치하지 않습니다.");
      const worker = await fs.promises.stat(path.join(temporary, WORKER_FILE));
      if (!worker.isFile()) throw new Error("AI 실행 파일을 찾을 수 없습니다.");
      const target = path.join(this.versionsPath(), manifest.runtimeVersion);
      const previous = `${target}.old-${crypto.randomUUID()}`;
      let movedPrevious = false;
      try {
        await fs.promises.rename(target, previous);
        movedPrevious = true;
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      let installedTarget = false;
      let currentBackup = "";
      try {
        await fs.promises.rename(temporary, target);
        installedTarget = true;
        const currentTemporary = `${this.currentPath()}.tmp`;
        await fs.promises.writeFile(currentTemporary, JSON.stringify({ version: manifest.runtimeVersion }, null, 2), "utf8");
        currentBackup = `${this.currentPath()}.old-${crypto.randomUUID()}`;
        try { await fs.promises.rename(this.currentPath(), currentBackup); }
        catch (error) { if (error.code !== "ENOENT") throw error; currentBackup = ""; }
        try { await fs.promises.rename(currentTemporary, this.currentPath()); }
        catch (error) {
          if (currentBackup) await fs.promises.rename(currentBackup, this.currentPath()).catch(() => {});
          throw error;
        }
      } catch (error) {
        if (installedTarget) await fs.promises.rm(target, { recursive: true, force: true }).catch(() => {});
        if (movedPrevious) await fs.promises.rename(previous, target).catch(() => {});
        throw error;
      }
      if (currentBackup) await fs.promises.unlink(currentBackup).catch(() => {});
      if (movedPrevious) await fs.promises.rm(previous, { recursive: true, force: true });
      onProgress?.({ stage: "complete", completed: 1, total: 1, percent: 100, message: "AI 검열 기능 설치 완료" });
      return this.installed();
    } finally {
      await fs.promises.rm(temporary, { recursive: true, force: true }).catch(() => {});
    }
  }

  async installLatest(onProgress) {
    if (this.installController) throw new Error("AI 검열 기능을 이미 설치하고 있습니다.");
    const controller = new AbortController();
    this.installController = controller;
    await fs.promises.mkdir(path.join(this.rootPath, "downloads"), { recursive: true });
    const temporaryArchive = path.join(this.rootPath, "downloads", `runtime-${crypto.randomUUID()}.zip`);
    try {
      const latest = await this.latest();
      const checksumResponse = await net.fetch(latest.checksumUrl, { signal: controller.signal, headers: { "User-Agent": "AAA" } });
      if (!checksumResponse.ok) throw new Error("AI 검열 기능 검증 정보를 다운로드하지 못했습니다.");
      const expectedHash = (await checksumResponse.text()).trim().split(/\s+/)[0]?.toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(expectedHash)) throw new Error("AI 검열 기능 검증 정보가 올바르지 않습니다.");
      await downloadFile(latest.archiveUrl, temporaryArchive, onProgress, controller.signal);
      onProgress?.({ stage: "verifying", completed: 0, total: 0, percent: 100, message: "AI 검열 기능 확인 중" });
      if (await sha256(temporaryArchive) !== expectedHash) throw new Error("다운로드한 AI 검열 기능의 무결성 확인에 실패했습니다.");
      return await this.installArchive(temporaryArchive, onProgress, { version: latest.latestVersion });
    } catch (error) {
      if (error.name === "AbortError") throw new Error("AI 검열 기능 설치를 취소했습니다.");
      throw error;
    } finally {
      this.installController = null;
      await fs.promises.unlink(temporaryArchive).catch(() => {});
    }
  }

  cancelInstall() { this.installController?.abort(); }

  async remove() {
    this.cancelInstall();
    await fs.promises.rm(this.rootPath, { recursive: true, force: true });
    return this.installed();
  }
}

module.exports = { AiRuntimeManager, RUNTIME_PROTOCOL_VERSION, compareVersions, runtimeRootPath, safeArchiveEntry, validVersion };
