const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("aaa", {
  chooseDirectory: () => ipcRenderer.invoke("dialog:choose-directory"),
  chooseModel: () => ipcRenderer.invoke("dialog:choose-model"),
  openDirectory: (directoryPath) => ipcRenderer.invoke("shell:open-directory", directoryPath),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  data: {
    backup: (preferences) => ipcRenderer.invoke("data:backup", { preferences }),
    fullBackup: (preferences) => ipcRenderer.invoke("data:full-backup", { preferences }),
    restore: () => ipcRenderer.invoke("data:restore")
  },
  updates: {
    getState: () => ipcRenderer.invoke("updates:get-state"),
    check: () => ipcRenderer.invoke("updates:check"),
    install: () => ipcRenderer.invoke("updates:install"),
    onStateChanged: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on("updates:state-changed", listener);
      return () => ipcRenderer.removeListener("updates:state-changed", listener);
    }
  },
  aiRuntime: {
    status: () => ipcRenderer.invoke("ai-runtime:status"),
    check: () => ipcRenderer.invoke("ai-runtime:check"),
    consumeInstallRequest: () => ipcRenderer.invoke("ai-runtime:consume-install-request"),
    install: () => ipcRenderer.invoke("ai-runtime:install"),
    installFromFile: () => ipcRenderer.invoke("ai-runtime:install-from-file"),
    cancelInstall: () => ipcRenderer.invoke("ai-runtime:cancel-install"),
    remove: () => ipcRenderer.invoke("ai-runtime:remove"),
    openFolder: () => ipcRenderer.invoke("ai-runtime:open-folder"),
    onProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on("ai-runtime:progress", listener);
      return () => ipcRenderer.removeListener("ai-runtime:progress", listener);
    }
  },
  markdown: {
    imageDataUrl: (source, basePath) => ipcRenderer.invoke("markdown:image-data-url", source, basePath)
  },
  stickers: {
    list: () => ipcRenderer.invoke("stickers:list"),
    add: () => ipcRenderer.invoke("stickers:add"),
    delete: (id) => ipcRenderer.invoke("stickers:delete", id)
  },
  gifs: {
    chooseImages: () => ipcRenderer.invoke("gifs:choose-images"),
    previewUrl: (imagePath) => ipcRenderer.invoke("gifs:preview-url", imagePath),
    createPreview: (input) => ipcRenderer.invoke("gifs:create-preview", input),
    updatePreview: (token, settings) => ipcRenderer.invoke("gifs:update-preview", token, settings),
    savePreview: (token) => ipcRenderer.invoke("gifs:save-preview", token),
    discardPreview: (token) => ipcRenderer.invoke("gifs:discard-preview", token)
  },
  getPathForFile: (file) => webUtils.getPathForFile(file),
  projects: {
    list: () => ipcRenderer.invoke("projects:list"),
    get: (id) => ipcRenderer.invoke("projects:get", id),
    create: (input) => ipcRenderer.invoke("projects:create", input),
    chooseArchive: () => ipcRenderer.invoke("projects:choose-archive"),
    restore: (input) => ipcRenderer.invoke("projects:restore", input),
    export: (id) => ipcRenderer.invoke("projects:export", id),
    save: (input) => ipcRenderer.invoke("projects:save", input),
    delete: (id) => ipcRenderer.invoke("projects:delete", id)
  },
  pathRules: {
    preview: (input) => ipcRenderer.invoke("path-rules:preview", input)
  },
  prompts: {
    list: (projectId) => ipcRenderer.invoke("prompts:list", projectId),
    get: (id) => ipcRenderer.invoke("prompts:get", id),
    create: (projectId) => ipcRenderer.invoke("prompts:create", projectId),
    duplicate: (id, projectId) => ipcRenderer.invoke("prompts:duplicate", id, projectId),
    save: (input) => ipcRenderer.invoke("prompts:save", input),
    delete: (id, projectId) => ipcRenderer.invoke("prompts:delete", id, projectId),
    reorder: (projectId, ids) => ipcRenderer.invoke("prompts:reorder", projectId, ids),
    listFolders: (projectId) => ipcRenderer.invoke("prompts:folders-list", projectId),
    createFolder: (projectId, name) => ipcRenderer.invoke("prompts:folders-create", projectId, name),
    renameFolder: (projectId, id, name) => ipcRenderer.invoke("prompts:folders-rename", projectId, id, name),
    deleteFolder: (projectId, id) => ipcRenderer.invoke("prompts:folders-delete", projectId, id),
    moveToFolder: (projectId, id, folderId) => ipcRenderer.invoke("prompts:folders-move", projectId, id, folderId)
  },
  situations: {
    list: (projectId) => ipcRenderer.invoke("situations:list", projectId),
    get: (id) => ipcRenderer.invoke("situations:get", id),
    create: (projectId) => ipcRenderer.invoke("situations:create", projectId),
    duplicate: (id, projectId) => ipcRenderer.invoke("situations:duplicate", id, projectId),
    save: (input) => ipcRenderer.invoke("situations:save", input),
    delete: (id, projectId) => ipcRenderer.invoke("situations:delete", id, projectId),
    reorder: (projectId, ids) => ipcRenderer.invoke("situations:reorder", projectId, ids),
    listFolders: (projectId) => ipcRenderer.invoke("situations:folders-list", projectId),
    createFolder: (projectId, name) => ipcRenderer.invoke("situations:folders-create", projectId, name),
    renameFolder: (projectId, id, name) => ipcRenderer.invoke("situations:folders-rename", projectId, id, name),
    deleteFolder: (projectId, id) => ipcRenderer.invoke("situations:folders-delete", projectId, id),
    moveToFolder: (projectId, id, folderId) => ipcRenderer.invoke("situations:folders-move", projectId, id, folderId)
  },
  promptTemplates: {
    list: (scopeId) => ipcRenderer.invoke("prompt-templates:list", scopeId),
    get: (id) => ipcRenderer.invoke("prompt-templates:get", id),
    create: (scopeId) => ipcRenderer.invoke("prompt-templates:create", scopeId),
    duplicate: (id, scopeId) => ipcRenderer.invoke("prompt-templates:duplicate", id, scopeId),
    save: (input) => ipcRenderer.invoke("prompt-templates:save", input),
    delete: (id, scopeId) => ipcRenderer.invoke("prompt-templates:delete", id, scopeId),
    reorder: (scopeId, ids) => ipcRenderer.invoke("prompt-templates:reorder", scopeId, ids),
    listFolders: () => ipcRenderer.invoke("prompt-template-folders:list"),
    createFolder: (_scopeId, name) => ipcRenderer.invoke("prompt-template-folders:create", name),
    renameFolder: (_scopeId, id, name) => ipcRenderer.invoke("prompt-template-folders:rename", id, name),
    deleteFolder: (_scopeId, id) => ipcRenderer.invoke("prompt-template-folders:delete", id),
    moveToFolder: (_scopeId, id, folderId) => ipcRenderer.invoke("prompt-template-folders:move", id, folderId)
  },
  situationTemplates: {
    list: (scopeId) => ipcRenderer.invoke("situation-templates:list", scopeId),
    get: (id) => ipcRenderer.invoke("situation-templates:get", id),
    create: (scopeId) => ipcRenderer.invoke("situation-templates:create", scopeId),
    duplicate: (id, scopeId) => ipcRenderer.invoke("situation-templates:duplicate", id, scopeId),
    save: (input) => ipcRenderer.invoke("situation-templates:save", input),
    delete: (id, scopeId) => ipcRenderer.invoke("situation-templates:delete", id, scopeId),
    reorder: (scopeId, ids) => ipcRenderer.invoke("situation-templates:reorder", scopeId, ids),
    listFolders: () => ipcRenderer.invoke("situation-template-folders:list"),
    createFolder: (_scopeId, name) => ipcRenderer.invoke("situation-template-folders:create", name),
    renameFolder: (_scopeId, id, name) => ipcRenderer.invoke("situation-template-folders:rename", id, name),
    deleteFolder: (_scopeId, id) => ipcRenderer.invoke("situation-template-folders:delete", id),
    moveToFolder: (_scopeId, id, folderId) => ipcRenderer.invoke("situation-template-folders:move", id, folderId)
  },
  lorebookTemplates: {
    list: (scopeId) => ipcRenderer.invoke("lorebook-templates:list", scopeId),
    get: (id) => ipcRenderer.invoke("lorebook-templates:get", id),
    create: (scopeId) => ipcRenderer.invoke("lorebook-templates:create", scopeId),
    duplicate: (id, scopeId) => ipcRenderer.invoke("lorebook-templates:duplicate", id, scopeId),
    reorder: (scopeId, ids) => ipcRenderer.invoke("lorebook-templates:reorder", scopeId, ids),
    save: (input) => ipcRenderer.invoke("lorebook-templates:save", input),
    delete: (id, scopeId) => ipcRenderer.invoke("lorebook-templates:delete", id, scopeId),
    listFolders: () => ipcRenderer.invoke("lorebook-template-folders:list"),
    createFolder: (_scopeId, name) => ipcRenderer.invoke("lorebook-template-folders:create", name),
    renameFolder: (_scopeId, id, name) => ipcRenderer.invoke("lorebook-template-folders:rename", id, name),
    deleteFolder: (_scopeId, id) => ipcRenderer.invoke("lorebook-template-folders:delete", id),
    moveToFolder: (_scopeId, id, folderId) => ipcRenderer.invoke("lorebook-template-folders:move", id, folderId)
  },
  lorebooks: {
    list: (projectId) => ipcRenderer.invoke("lorebooks:list", projectId),
    get: (id) => ipcRenderer.invoke("lorebooks:get", id),
    create: (projectId) => ipcRenderer.invoke("lorebooks:create", projectId),
    duplicate: (id, projectId) => ipcRenderer.invoke("lorebooks:duplicate", id, projectId),
    reorder: (projectId, ids) => ipcRenderer.invoke("lorebooks:reorder", projectId, ids),
    save: (input) => ipcRenderer.invoke("lorebooks:save", input),
    delete: (id, projectId) => ipcRenderer.invoke("lorebooks:delete", id, projectId),
    listFolders: (projectId) => ipcRenderer.invoke("lorebooks:folders-list", projectId),
    createFolder: (projectId, name) => ipcRenderer.invoke("lorebooks:folders-create", projectId, name),
    renameFolder: (projectId, id, name) => ipcRenderer.invoke("lorebooks:folders-rename", projectId, id, name),
    deleteFolder: (projectId, id) => ipcRenderer.invoke("lorebooks:folders-delete", projectId, id),
    moveToFolder: (projectId, id, folderId) => ipcRenderer.invoke("lorebooks:folders-move", projectId, id, folderId)
  },
  assets: {
    list: (projectId) => ipcRenderer.invoke("assets:list", projectId),
    aiCensor: (input) => ipcRenderer.invoke("assets:ai-censor", input),
    aiLogs: () => ipcRenderer.invoke("assets:ai-logs"),
    cancelAi: () => ipcRenderer.invoke("assets:cancel-ai"),
    onAiProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on("assets:ai-progress", listener);
      return () => ipcRenderer.removeListener("assets:ai-progress", listener);
    },
    refresh: (projectId) => ipcRenderer.invoke("assets:refresh", projectId),
    syncExternal: (projectId, targetExtension) => ipcRenderer.invoke("assets:sync-external", projectId, targetExtension),
    forget: (assetId) => ipcRenderer.invoke("assets:forget", assetId),
    delete: (assetId) => ipcRenderer.invoke("assets:delete", assetId),
    setReview: (assetId, status, options) => ipcRenderer.invoke("assets:set-review", assetId, status, options),
    saveCensored: (assetId, dataUrl) => ipcRenderer.invoke("assets:save-censored", assetId, dataUrl),
    dataUrl: (assetId, original = false) => ipcRenderer.invoke("assets:data-url", assetId, original),
    url: (assetId, original = false) => ipcRenderer.invoke("assets:url", assetId, original),
    classify: (input) => ipcRenderer.invoke("assets:classify", input)
  },
  standaloneAi: {
    chooseFiles: () => ipcRenderer.invoke("standalone-ai:choose-files"),
    chooseFolder: () => ipcRenderer.invoke("standalone-ai:choose-folder"),
    run: (input) => ipcRenderer.invoke("standalone-ai:run", input),
    cancel: () => ipcRenderer.invoke("standalone-ai:cancel"),
    onProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on("standalone-ai:progress", listener);
      return () => ipcRenderer.removeListener("standalone-ai:progress", listener);
    }
  },
  works: {
    get: (projectId) => ipcRenderer.invoke("works:get", projectId),
    save: (input) => ipcRenderer.invoke("works:save", input),
    listImages: (projectId) => ipcRenderer.invoke("works:list-images", projectId),
    createSlot: (projectId) => ipcRenderer.invoke("works:create-slot", projectId),
    addImage: (input) => ipcRenderer.invoke("works:add-image", input),
    deleteImage: (projectId, id) => ipcRenderer.invoke("works:delete-image", projectId, id),
    deleteSlot: (projectId, id) => ipcRenderer.invoke("works:delete-slot", projectId, id)
  },
  window: {
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
    close: () => ipcRenderer.send("window:close"),
    confirmClose: () => ipcRenderer.invoke("window:confirm-close"),
    isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
    onMaximizedChanged: (callback) => {
      const listener = (_event, isMaximized) => callback(isMaximized);
      ipcRenderer.on("window:maximized-changed", listener);
      return () => ipcRenderer.removeListener("window:maximized-changed", listener);
    },
    onCloseRequested: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("window:close-requested", listener);
      return () => ipcRenderer.removeListener("window:close-requested", listener);
    }
  }
});
