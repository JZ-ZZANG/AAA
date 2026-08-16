const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

async function existingManagedFiles(paths) {
  const unique = new Map();
  for (const value of paths) {
    if (typeof value !== "string" || !value.trim()) continue;
    const resolved = path.resolve(value);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (unique.has(key)) continue;
    try {
      const stats = await fs.promises.stat(resolved);
      if (!stats.isFile()) throw new Error(`삭제 대상이 파일이 아닙니다: ${resolved}`);
      unique.set(key, resolved);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return [...unique.values()];
}

async function restoreStagedFiles(staged) {
  const errors = [];
  for (const entry of [...staged].reverse()) {
    try {
      try { await fs.promises.access(entry.originalPath); throw new Error(`원래 위치에 다른 파일이 생겨 복원할 수 없습니다: ${entry.originalPath}`); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      await fs.promises.rename(entry.stagedPath, entry.originalPath);
    } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, "삭제 작업 실패 후 파일 복원에 실패했습니다.");
}

async function withStagedFileDeletion(paths, commitDatabaseChange) {
  const files = await existingManagedFiles(paths);
  const staged = [];
  try {
    for (const originalPath of files) {
      const extension = path.extname(originalPath);
      const stagedPath = path.join(path.dirname(originalPath), `.aaa-delete-${crypto.randomUUID()}${extension}`);
      await fs.promises.rename(originalPath, stagedPath);
      staged.push({ originalPath, stagedPath });
    }
  } catch (error) {
    try { await restoreStagedFiles(staged); }
    catch (restoreError) { throw new AggregateError([error, restoreError], "파일을 삭제 준비 상태로 옮기지 못했고 일부 복원에도 실패했습니다."); }
    throw error;
  }

  try {
    const result = await commitDatabaseChange();
    await Promise.allSettled(staged.map((entry) => fs.promises.unlink(entry.stagedPath)));
    return result;
  } catch (error) {
    try { await restoreStagedFiles(staged); }
    catch (restoreError) { throw new AggregateError([error, restoreError], "DB 변경 실패 후 파일 복원에도 실패했습니다."); }
    throw error;
  }
}

module.exports = { withStagedFileDeletion };
