import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Circle, Copy, Droplet, Eraser, Eye, Grid3X3, Home as HomeIcon, LayoutGrid, Minus, MoveDiagonal2, Paintbrush, PaintBucket, Palette, PanelLeftClose, PanelLeftOpen, Pencil, Plus, RectangleHorizontal, RectangleVertical, Redo2, RefreshCcw, RotateCw, ScrollText, Search, Settings as SettingsIcon, SlidersHorizontal, Square, SquareDashed, Star, Sticker, Trash2, Undo2, X } from "lucide-react";
import { DeleteConfirmModal } from "../components/Shell";
import { CENSOR_TARGET_OPTIONS, matchesProjectPath, savedCensorShortcuts, savedCensorshipSettings, matchesInputShortcut, registerCensorEditFlusher, flushCensorEdits } from "../shared";
import { STICKER_FAVORITES_EVENT, readStickerFavoriteIds } from "../sticker-favorites";
import { TWEMOJI_CATEGORIES, categorizedTwemojiIds, twemojiCharacter, twemojiSticker } from "../twemoji-library";

const MAX_UNDO_HISTORY = 20;
const TWEMOJI_PAGE_SIZE = 96;
const CUSTOM_STICKERS_EVENT = "aaa-custom-stickers-changed";

function aiLogTime(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("ko-KR", { hour12: false });
}

function normalizedSearchText(value) {
  return String(value || "").normalize("NFKC").replaceAll("\\", "/").toLocaleLowerCase();
}

function ManualCensorEditor({ asset, project, editorSettings, onEditorSettingsChange, onClose, onSaved, onSaveError, onReset, onMarkManual, embedded = false, shortcuts = savedCensorShortcuts() }: any) {
  const canvasRef = useRef(null);
  const { mode, tool, shape, color, size, hardness, opacity } = editorSettings;
  const updateEditorSetting = (key, value) => onEditorSettingsChange((current) => ({ ...current, [key]: typeof value === "function" ? value(current[key]) : value }));
  const setTool = (value) => updateEditorSetting("tool", value);
  const setMode = (value) => updateEditorSetting("mode", value);
  const setShape = (value) => updateEditorSetting("shape", value);
  const setColor = (value) => updateEditorSetting("color", value);
  const setSize = (value) => updateEditorSetting("size", value);
  const setHardness = (value) => updateEditorSetting("hardness", value);
  const setOpacity = (value) => updateEditorSetting("opacity", value);
  const [zoom, setZoom] = useState(100);
  const [fittedSize, setFittedSize] = useState({ width: 0, height: 0 });
  const [drawing, setDrawing] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [loadStatus, setLoadStatus] = useState("loading");
  const [loadMessage, setLoadMessage] = useState("");
  const [loadVersion, setLoadVersion] = useState(0);
  const [brushSettingsOpen, setBrushSettingsOpen] = useState(false);
  const [methodMenuOpen, setMethodMenuOpen] = useState(false);
  const [areaToolActive, setAreaToolActive] = useState(false);
  const [areaPreview, setAreaPreview] = useState(null);
  const [stickerMenuOpen, setStickerMenuOpen] = useState(false);
  const [stickerToolActive, setStickerToolActive] = useState(false);
  const [selectedSticker, setSelectedSticker] = useState(null);
  const [customStickers, setCustomStickers] = useState([]);
  const [stickerCategory, setStickerCategory] = useState("custom");
  const [favoriteEmojiIds, setFavoriteEmojiIds] = useState(readStickerFavoriteIds);
  const [emojiLimit, setEmojiLimit] = useState(TWEMOJI_PAGE_SIZE);
  const [stickerPreview, setStickerPreview] = useState(null);
  const [stickerTransformPreview, setStickerTransformPreview] = useState(null);
  const [stickerError, setStickerError] = useState("");
  const [deleteStickerTarget, setDeleteStickerTarget] = useState(null);
  const [stickerDeleting, setStickerDeleting] = useState(false);
  const [originalPreviewHeld, setOriginalPreviewHeld] = useState(false);
  const [historyAvailability, setHistoryAvailability] = useState({ undo: false, redo: false });
  const [cursor, setCursor] = useState({ visible: false, x: 0, y: 0, size: 0 });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("aaa-censorship-sidebar-collapsed") === "true");
  const history = useRef([]);
  const redoHistory = useRef([]);
  const stickerEmojiGridRef = useRef(null);
  const stickerCategoryDrag = useRef({ pointerId: null, startX: 0, scrollLeft: 0, moved: false });
  const originalPreviewRef = useRef(null);
  const strokeEffect = useRef(null);
  const strokeStamp = useRef(null);
  const strokeMode = useRef("brush");
  const areaDrag = useRef(null);
  const stickerDrag = useRef(null);
  const pendingSticker = useRef(null);
  const stickerTransformDrag = useRef(null);
  const stickerImage = useRef(null);
  const originalImage = useRef(null);
  const lastPoint = useRef(null);
  const lastAnchor = useRef(null);
  const panState = useRef(null);
  const brushSettingsRef = useRef(null);
  const methodMenuRef = useRef(null);
  const stickerMenuRef = useRef(null);
  const saveState = useRef({ timer: null, inFlight: false, activePromise: null, pending: null });

  useEffect(() => {
    let active = true;
    const loadImage = (source) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("이미지 파일이 손상되었거나 지원하지 않는 형식입니다."));
      image.src = source;
    });
    setLoadStatus("loading");
    setLoadMessage("");
    (async () => {
      try {
        const [source, originalSource] = await Promise.all([window.aaa.assets.url(asset.id), window.aaa.assets.url(asset.id, true)]);
        const original = await loadImage(originalSource);
        let image;
        let fallback = false;
        try { image = await loadImage(source); }
        catch { image = original; fallback = true; }
        if (!active || !canvasRef.current) return;
        const canvas = canvasRef.current;
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext("2d").drawImage(image, 0, 0);
        const copy = document.createElement("canvas");
        copy.width = original.naturalWidth;
        copy.height = original.naturalHeight;
        copy.getContext("2d").drawImage(original, 0, 0);
        originalImage.current = copy;
        const originalPreview = originalPreviewRef.current;
        if (originalPreview) {
          originalPreview.width = original.naturalWidth;
          originalPreview.height = original.naturalHeight;
          originalPreview.getContext("2d").drawImage(original, 0, 0);
        }
        history.current = [];
        redoHistory.current = [];
        syncHistoryAvailability();
        lastAnchor.current = null;
        lastPoint.current = null;
        const area = canvas.closest(".editor-canvas");
        const scale = Math.min((area.clientWidth - 36) / image.naturalWidth, (area.clientHeight - 36) / image.naturalHeight, 1);
        setFittedSize({ width: image.naturalWidth * scale, height: image.naturalHeight * scale });
        setLoadStatus("ready");
        if (fallback) setLoadMessage("검열본을 불러오지 못해 원본 이미지를 표시합니다.");
      } catch (error) {
        if (!active) return;
        setLoadStatus("error");
        setLoadMessage(error.message || "이미지를 불러오지 못했습니다.");
      }
    })();
    return () => { active = false; };
  }, [asset.id, loadVersion]);
  useEffect(() => () => {
    const state = saveState.current;
    if (state.timer) clearTimeout(state.timer);
    if (state.pending) {
      const pending = state.pending;
      state.pending = null;
      window.aaa.assets.saveCensored(asset.id, pending).catch((error) => onSaveError?.(`검열 이미지를 저장하지 못했습니다: ${error.message}`));
    }
  }, [asset.id]);
  useEffect(() => {
    const flush = () => flushForClose();
    return registerCensorEditFlusher(flush);
  }, [asset.id]);
  useEffect(() => {
    const listener = (event) => {
      if (event.key === "Escape" && (areaDrag.current || stickerDrag.current || pendingSticker.current || stickerToolActive || stickerMenuOpen)) {
        event.preventDefault();
        if (stickerDrag.current) cancelStickerStroke();
        else if (areaDrag.current) cancelAreaStroke();
        else if (pendingSticker.current) cancelPendingSticker();
        setStickerToolActive(false);
        setStickerMenuOpen(false);
        return;
      }
      if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName) || event.repeat) return;
      if (matchesInputShortcut(event, shortcuts.originalPreview)) { event.preventDefault(); setOriginalPreviewHeld(true); }
      else if (matchesInputShortcut(event, shortcuts.manualToggle)) { event.preventDefault(); if (loadStatus === "ready") toggleManualReview(); }
      else if (matchesInputShortcut(event, shortcuts.brushEraserToggle)) { event.preventDefault(); setAreaToolActive(false); setStickerToolActive(false); setMode(mode === "brush" ? "eraser" : "brush"); }
      else if (matchesInputShortcut(event, shortcuts.methodCycle)) { event.preventDefault(); setAreaToolActive(false); setStickerToolActive(false); setTool(tool === "solid" ? "blur" : tool === "blur" ? "mosaic" : "solid"); }
      else if (matchesInputShortcut(event, shortcuts.shapeToggle)) { event.preventDefault(); setAreaToolActive(false); setStickerToolActive(false); setShape(shape === "circle" ? "square" : "circle"); }
      else if (embedded && matchesInputShortcut(event, shortcuts.sidebarToggle)) { event.preventDefault(); setSidebarCollapsed((current) => !current); }
      else if (matchesInputShortcut(event, shortcuts.undo)) { event.preventDefault(); undo(); }
      else if (matchesInputShortcut(event, shortcuts.redo)) { event.preventDefault(); redo(); }
      else adjustByShortcut(event);
    };
    const release = (event) => { if (matchesInputShortcut(event, shortcuts.originalPreview)) setOriginalPreviewHeld(false); };
    const releaseOnBlur = () => { setOriginalPreviewHeld(false); if (stickerDrag.current) cancelStickerStroke(); else if (areaDrag.current) cancelAreaStroke(); };
    window.addEventListener("keydown", listener);
    window.addEventListener("keyup", release);
    window.addEventListener("blur", releaseOnBlur);
    return () => {
      window.removeEventListener("keydown", listener);
      window.removeEventListener("keyup", release);
      window.removeEventListener("blur", releaseOnBlur);
    };
  });
  useEffect(() => { const area = canvasRef.current?.closest(".editor-canvas"); if (!area) return; const listener = (event) => adjustByWheel(event); area.addEventListener("wheel", listener, { passive: false }); return () => area.removeEventListener("wheel", listener); });
  useEffect(() => {
    const area = canvasRef.current?.closest(".editor-canvas"); if (!area) return;
    const down = (event) => { if (!event.altKey) return; event.preventDefault(); event.stopPropagation(); panState.current = { x: event.clientX, y: event.clientY, left: area.scrollLeft, top: area.scrollTop, pointerId: event.pointerId }; area.classList.add("panning"); area.setPointerCapture(event.pointerId); };
    const move = (event) => { const pan = panState.current; if (!pan) return; event.preventDefault(); area.scrollLeft = pan.left - (event.clientX - pan.x); area.scrollTop = pan.top - (event.clientY - pan.y); };
    const up = (event) => { if (!panState.current) return; panState.current = null; area.classList.remove("panning"); if (area.hasPointerCapture(event.pointerId)) area.releasePointerCapture(event.pointerId); };
    area.addEventListener("pointerdown", down, true); area.addEventListener("pointermove", move, true); area.addEventListener("pointerup", up, true); area.addEventListener("pointercancel", up, true);
    return () => { area.removeEventListener("pointerdown", down, true); area.removeEventListener("pointermove", move, true); area.removeEventListener("pointerup", up, true); area.removeEventListener("pointercancel", up, true); };
  });
  useEffect(() => { const canvas = canvasRef.current; if (!canvas || !fittedSize.width) return; canvas.style.width = `${fittedSize.width * zoom / 100}px`; canvas.style.height = `${fittedSize.height * zoom / 100}px`; }, [zoom, fittedSize]);
  useEffect(() => {
    if (!embedded) return undefined;
    const workspace = canvasRef.current?.closest(".censorship-workspace");
    workspace?.classList.toggle("sidebar-collapsed", sidebarCollapsed);
    localStorage.setItem("aaa-censorship-sidebar-collapsed", String(sidebarCollapsed));
    return () => workspace?.classList.remove("sidebar-collapsed");
  }, [embedded, sidebarCollapsed]);
  useEffect(() => {
    if (!brushSettingsOpen && !methodMenuOpen && !stickerMenuOpen) return undefined;
    const closeOnOutsidePointer = (event) => {
      if (!brushSettingsRef.current?.contains(event.target)) setBrushSettingsOpen(false);
      if (!methodMenuRef.current?.contains(event.target)) setMethodMenuOpen(false);
      if (!stickerMenuRef.current?.contains(event.target)) setStickerMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      setBrushSettingsOpen(false);
      setMethodMenuOpen(false);
      setStickerMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [brushSettingsOpen, methodMenuOpen, stickerMenuOpen]);
  useEffect(() => {
    let active = true;
    window.aaa.stickers.list().then((items) => { if (active) setCustomStickers(items); }).catch((error) => { if (active) setStickerError(error.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const updateFavorites = (event) => setFavoriteEmojiIds(event.detail || readStickerFavoriteIds());
    const updateCustomStickers = (event) => {
      const items = event.detail || [];
      setCustomStickers(items);
      setSelectedSticker((current) => {
        if (!current || current.twemojiId || items.some((item) => item.id === current.id)) return current;
        cancelPendingSticker();
        setStickerToolActive(false);
        stickerImage.current = null;
        return null;
      });
    };
    window.addEventListener(STICKER_FAVORITES_EVENT, updateFavorites);
    window.addEventListener(CUSTOM_STICKERS_EVENT, updateCustomStickers);
    return () => {
      window.removeEventListener(STICKER_FAVORITES_EVENT, updateFavorites);
      window.removeEventListener(CUSTOM_STICKERS_EVENT, updateCustomStickers);
    };
  }, []);
  useEffect(() => {
    setEmojiLimit(TWEMOJI_PAGE_SIZE);
    if (stickerEmojiGridRef.current) stickerEmojiGridRef.current.scrollTop = 0;
  }, [stickerCategory]);
  useEffect(() => {
    if (!stickerToolActive && pendingSticker.current) commitPendingSticker();
  }, [stickerToolActive]);
  useEffect(() => {
    setBrushSettingsOpen(false);
    setMethodMenuOpen(false);
    setStickerMenuOpen(false);
    setOriginalPreviewHeld(false);
    if (stickerDrag.current) cancelStickerStroke();
    else cancelAreaStroke();
  }, [asset.id]);
  function point(event) { const canvas = canvasRef.current; const box = canvas.getBoundingClientRect(); return { x: (event.clientX - box.left) * canvas.width / box.width, y: (event.clientY - box.top) * canvas.height / box.height }; }
  function updateCursor(event) {
    const canvas = canvasRef.current; const box = canvas.getBoundingClientRect();
    setCursor({ visible: true, x: event.clientX - box.left, y: event.clientY - box.top, size: size * box.width / canvas.width });
  }
  function brushStamp() {
    const stamp = document.createElement("canvas"); const extent = Math.max(2, Math.ceil(size)); stamp.width = extent; stamp.height = extent; const context = stamp.getContext("2d"); const radius = extent / 2; const hard = Math.min(.999, hardness / 100);
    context.fillStyle = color; context.fillRect(0, 0, extent, extent); context.globalCompositeOperation = "destination-in";
    if (shape === "circle") { const gradient = context.createRadialGradient(radius, radius, radius * hard, radius, radius, radius); gradient.addColorStop(0, `rgba(0,0,0,${opacity / 100})`); gradient.addColorStop(1, "rgba(0,0,0,0)"); context.fillStyle = gradient; context.fillRect(0, 0, extent, extent); }
    else { const mask = document.createElement("canvas"); mask.width = extent; mask.height = extent; const maskContext = mask.getContext("2d"); const image = maskContext.createImageData(extent, extent); for (let y = 0; y < extent; y += 1) for (let x = 0; x < extent; x += 1) { const offset = (y * extent + x) * 4; const distance = Math.max(Math.abs(x + .5 - radius), Math.abs(y + .5 - radius)) / radius; const alpha = distance <= hard ? opacity / 100 : Math.max(0, 1 - (distance - hard) / Math.max(.001, 1 - hard)) * opacity / 100; image.data[offset] = 255; image.data[offset + 1] = 255; image.data[offset + 2] = 255; image.data[offset + 3] = Math.round(alpha * 255); } maskContext.putImageData(image, 0, 0); context.drawImage(mask, 0, 0); }
    return stamp;
  }
  function dab(x, y) {
    const canvas = canvasRef.current; const context = canvas.getContext("2d"); const radius = size / 2; const stamp = strokeStamp.current || brushStamp();
    if (strokeMode.current === "brush" && tool === "solid") context.drawImage(stamp, x - radius, y - radius, size, size);
    else if (strokeEffect.current) { const patch = document.createElement("canvas"); patch.width = stamp.width; patch.height = stamp.height; const output = patch.getContext("2d"); output.drawImage(strokeEffect.current, x - radius, y - radius, size, size, 0, 0, stamp.width, stamp.height); output.globalCompositeOperation = "destination-in"; output.drawImage(stamp, 0, 0); context.drawImage(patch, x - radius, y - radius, size, size); }
  }
  function applyBrush(event, force = false) {
    if (!drawing && !force) return;
    updateCursor(event);
    const current = point(event); const previous = lastPoint.current || current; const distance = Math.hypot(current.x - previous.x, current.y - previous.y); const spacing = Math.max(1, size * .12); const steps = Math.max(1, Math.ceil(distance / spacing));
    for (let index = 1; index <= steps; index += 1) dab(previous.x + (current.x - previous.x) * index / steps, previous.y + (current.y - previous.y) * index / steps);
    lastPoint.current = current;
  }
  function pushHistory() {
    const canvas = canvasRef.current;
    history.current.push(canvas.toDataURL());
    if (history.current.length > MAX_UNDO_HISTORY) history.current.shift();
    redoHistory.current = [];
    syncHistoryAvailability();
  }
  function prepareStrokeEffect() {
    const canvas = canvasRef.current;
    if (strokeMode.current === "eraser") {
      strokeEffect.current = originalImage.current;
      return;
    }
    if (tool !== "blur" && tool !== "mosaic") {
      strokeEffect.current = null;
      return;
    }
    const effect = document.createElement("canvas");
    effect.width = canvas.width;
    effect.height = canvas.height;
    const output = effect.getContext("2d");
    if (tool === "blur") {
      output.filter = `blur(${Math.max(2, (100 - hardness) / 5)}px)`;
      output.drawImage(canvas, 0, 0);
    } else {
      const block = Math.max(3, Math.round(size / 10));
      const tiny = document.createElement("canvas");
      tiny.width = Math.max(1, Math.ceil(canvas.width / block));
      tiny.height = Math.max(1, Math.ceil(canvas.height / block));
      tiny.getContext("2d").drawImage(canvas, 0, 0, tiny.width, tiny.height);
      output.imageSmoothingEnabled = false;
      output.drawImage(tiny, 0, 0, canvas.width, canvas.height);
    }
    strokeEffect.current = effect;
  }
  function constrainedAreaPoint(startPoint, currentPoint, constrain) {
    if (!constrain) return currentPoint;
    const deltaX = currentPoint.x - startPoint.x;
    const deltaY = currentPoint.y - startPoint.y;
    const extent = Math.max(Math.abs(deltaX), Math.abs(deltaY));
    return {
      x: startPoint.x + extent * (Math.sign(deltaX) || 1),
      y: startPoint.y + extent * (Math.sign(deltaY) || 1)
    };
  }
  function normalizedAreaBounds(startPoint, endPoint) {
    const canvas = canvasRef.current;
    const startX = Math.max(0, Math.min(canvas.width, startPoint.x));
    const startY = Math.max(0, Math.min(canvas.height, startPoint.y));
    const endX = Math.max(0, Math.min(canvas.width, endPoint.x));
    const endY = Math.max(0, Math.min(canvas.height, endPoint.y));
    return {
      left: Math.min(startX, endX),
      top: Math.min(startY, endY),
      width: Math.abs(endX - startX),
      height: Math.abs(endY - startY)
    };
  }
  function updateAreaPreview(event) {
    const drag = areaDrag.current;
    if (!drag) return;
    const current = constrainedAreaPoint(drag.start, point(event), event.shiftKey);
    drag.current = current;
    const bounds = normalizedAreaBounds(drag.start, current);
    const canvas = canvasRef.current;
    setAreaPreview({
      left: `${bounds.left / canvas.width * 100}%`,
      top: `${bounds.top / canvas.height * 100}%`,
      width: `${bounds.width / canvas.width * 100}%`,
      height: `${bounds.height / canvas.height * 100}%`
    });
  }
  function startAreaStroke(event) {
    const canvas = canvasRef.current;
    event.preventDefault();
    setDrawing(true);
    setCursor((current) => ({ ...current, visible: false }));
    canvas.setPointerCapture(event.pointerId);
    strokeMode.current = event.button === 2 ? (mode === "brush" ? "eraser" : "brush") : mode;
    prepareStrokeEffect();
    const startPoint = point(event);
    areaDrag.current = { start: startPoint, current: startPoint, pointerId: event.pointerId };
    updateAreaPreview(event);
  }
  function applyArea(bounds) {
    const canvas = canvasRef.current;
    const left = Math.floor(bounds.left);
    const top = Math.floor(bounds.top);
    const right = Math.ceil(bounds.left + bounds.width);
    const bottom = Math.ceil(bounds.top + bounds.height);
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);
    const patch = document.createElement("canvas");
    patch.width = width;
    patch.height = height;
    const output = patch.getContext("2d");
    if (strokeMode.current === "brush" && tool === "solid") {
      output.fillStyle = color;
      output.fillRect(0, 0, width, height);
    } else if (strokeEffect.current) {
      output.drawImage(strokeEffect.current, left, top, width, height, 0, 0, width, height);
    }
    const mask = document.createElement("canvas");
    const maskScale = Math.min(1, 512 / Math.max(width, height));
    mask.width = Math.max(1, Math.ceil(width * maskScale));
    mask.height = Math.max(1, Math.ceil(height * maskScale));
    const maskContext = mask.getContext("2d");
    const image = maskContext.createImageData(mask.width, mask.height);
    const hard = hardness / 100;
    const maximumOpacity = opacity / 100;
    for (let y = 0; y < mask.height; y += 1) {
      for (let x = 0; x < mask.width; x += 1) {
        const normalizedX = Math.abs((x + .5) / mask.width * 2 - 1);
        const normalizedY = Math.abs((y + .5) / mask.height * 2 - 1);
        const distance = Math.max(normalizedX, normalizedY);
        const edgeAlpha = distance > 1 ? 0 : hard >= 1 || distance <= hard ? 1 : Math.max(0, 1 - (distance - hard) / Math.max(.001, 1 - hard));
        image.data[(y * mask.width + x) * 4 + 3] = Math.round(edgeAlpha * maximumOpacity * 255);
      }
    }
    maskContext.putImageData(image, 0, 0);
    output.globalCompositeOperation = "destination-in";
    output.drawImage(mask, 0, 0, width, height);
    canvas.getContext("2d").drawImage(patch, left, top);
  }
  function loadStickerImage(sticker) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("스티커 이미지를 불러오지 못했습니다."));
      image.src = sticker.url;
    });
  }
  function setPendingSticker(sticker) {
    pendingSticker.current = sticker;
    setStickerTransformPreview(sticker ? { src: sticker.src, bounds: sticker.bounds, rotation: sticker.rotation } : null);
  }
  function cancelPendingSticker() {
    const drag = stickerTransformDrag.current;
    if (drag?.target?.hasPointerCapture(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId);
    stickerTransformDrag.current = null;
    setPendingSticker(null);
  }
  function commitPendingSticker() {
    const sticker = pendingSticker.current;
    const canvas = canvasRef.current;
    if (!sticker || !canvas) return false;
    const { left, top, width, height } = sticker.bounds;
    const centerX = left + width / 2;
    const centerY = top + height / 2;
    pushHistory();
    const context = canvas.getContext("2d");
    context.save();
    context.translate(centerX, centerY);
    context.rotate(sticker.rotation * Math.PI / 180);
    context.drawImage(sticker.image, -width / 2, -height / 2, width, height);
    context.restore();
    setPendingSticker(null);
    stickerTransformDrag.current = null;
    lastAnchor.current = null;
    persist();
    return true;
  }
  function startStickerTransform(event, type) {
    const sticker = pendingSticker.current;
    if (!sticker || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const center = { x: sticker.bounds.left + sticker.bounds.width / 2, y: sticker.bounds.top + sticker.bounds.height / 2 };
    const current = point(event);
    stickerTransformDrag.current = {
      type,
      pointerId: event.pointerId,
      target: event.currentTarget,
      center,
      initialPoint: current,
      initialBounds: { ...sticker.bounds },
      initialRotation: sticker.rotation,
      initialAngle: Math.atan2(current.y - center.y, current.x - center.x),
      initialDistance: Math.max(1, Math.hypot(current.x - center.x, current.y - center.y))
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function updateStickerTransform(event) {
    const drag = stickerTransformDrag.current;
    const sticker = pendingSticker.current;
    if (!drag || !sticker || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const current = point(event);
    if (drag.type === "move") {
      const canvas = canvasRef.current;
      const rawLeft = drag.initialBounds.left + current.x - drag.initialPoint.x;
      const rawTop = drag.initialBounds.top + current.y - drag.initialPoint.y;
      const visibleWidth = Math.min(16, drag.initialBounds.width);
      const visibleHeight = Math.min(16, drag.initialBounds.height);
      const left = Math.max(visibleWidth - drag.initialBounds.width, Math.min(canvas.width - visibleWidth, rawLeft));
      const top = Math.max(visibleHeight - drag.initialBounds.height, Math.min(canvas.height - visibleHeight, rawTop));
      setPendingSticker({ ...sticker, bounds: { ...drag.initialBounds, left, top } });
      return;
    }
    if (drag.type === "rotate") {
      const angle = Math.atan2(current.y - drag.center.y, current.x - drag.center.x);
      const rawRotation = drag.initialRotation + (angle - drag.initialAngle) * 180 / Math.PI;
      const rotation = ((rawRotation + 180) % 360 + 360) % 360 - 180;
      setPendingSticker({ ...sticker, rotation });
      return;
    }
    const scale = Math.max(.1, Math.hypot(current.x - drag.center.x, current.y - drag.center.y) / drag.initialDistance);
    const width = Math.max(8, drag.initialBounds.width * scale);
    const height = Math.max(8, drag.initialBounds.height * scale);
    setPendingSticker({ ...sticker, bounds: { left: drag.center.x - width / 2, top: drag.center.y - height / 2, width, height } });
  }
  function finishStickerTransform(event) {
    const drag = stickerTransformDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    stickerTransformDrag.current = null;
  }
  async function selectSticker(sticker) {
    try {
      commitPendingSticker();
      const source = await loadStickerImage(sticker);
      stickerImage.current = source;
      setSelectedSticker({ ...sticker, previewUrl: sticker.url });
      setStickerToolActive(true);
      setAreaToolActive(false);
      setStickerMenuOpen(false);
      setStickerError("");
    } catch (error) {
      setStickerError(error.message);
    }
  }
  function toggleStickerTool() {
    setBrushSettingsOpen(false);
    setMethodMenuOpen(false);
    if (stickerToolActive) {
      if (stickerDrag.current) cancelStickerStroke();
      if (pendingSticker.current) cancelPendingSticker();
      setStickerToolActive(false);
      setStickerMenuOpen(false);
      return;
    }
    setStickerMenuOpen((current) => !current);
  }
  async function addCustomStickers() {
    try {
      const items = await window.aaa.stickers.add();
      setCustomStickers(items);
      window.dispatchEvent(new CustomEvent(CUSTOM_STICKERS_EVENT, { detail: items }));
      setStickerCategory("custom");
      setStickerError("");
    } catch (error) {
      setStickerError(error.message);
    }
  }
  async function removeCustomSticker() {
    if (!deleteStickerTarget || stickerDeleting) return;
    const sticker = deleteStickerTarget;
    setStickerDeleting(true);
    try {
      const items = await window.aaa.stickers.delete(sticker.id);
      setCustomStickers(items);
      window.dispatchEvent(new CustomEvent(CUSTOM_STICKERS_EVENT, { detail: items }));
      if (selectedSticker?.id === sticker.id) {
        setStickerToolActive(false);
        setSelectedSticker(null);
        stickerImage.current = null;
      }
      setDeleteStickerTarget(null);
      setStickerError("");
    } catch (error) {
      setStickerError(error.message);
    }
    finally { setStickerDeleting(false); }
  }
  function stickerSourceSize() {
    const source = stickerImage.current;
    return { width: source?.naturalWidth || source?.width || 1, height: source?.naturalHeight || source?.height || 1 };
  }
  function normalizedStickerBounds(startPoint, endPoint, useDefault = false) {
    const canvas = canvasRef.current;
    const source = stickerSourceSize();
    const aspect = source.width / source.height;
    const startX = startPoint.x;
    const startY = startPoint.y;
    const deltaX = endPoint.x - startPoint.x;
    const deltaY = endPoint.y - startPoint.y;
    if (useDefault || (Math.abs(deltaX) < 2 && Math.abs(deltaY) < 2)) {
      const width = Math.min(canvas.width * .25, canvas.height * .25 * aspect);
      const height = width / aspect;
      return { left: startX - width / 2, top: startY - height / 2, width, height };
    }
    const directionX = Math.sign(deltaX) || 1;
    const directionY = Math.sign(deltaY) || 1;
    const width = Math.max(Math.abs(deltaX), Math.abs(deltaY) * aspect);
    const height = width / aspect;
    return { left: directionX > 0 ? startX : startX - width, top: directionY > 0 ? startY : startY - height, width, height };
  }
  function updateStickerPreview(event) {
    const drag = stickerDrag.current;
    if (!drag || !selectedSticker) return;
    drag.current = point(event);
    const bounds = normalizedStickerBounds(drag.start, drag.current);
    const canvas = canvasRef.current;
    setStickerPreview({
      src: selectedSticker.previewUrl,
      style: { left: `${bounds.left / canvas.width * 100}%`, top: `${bounds.top / canvas.height * 100}%`, width: `${bounds.width / canvas.width * 100}%`, height: `${bounds.height / canvas.height * 100}%` }
    });
  }
  function startStickerStroke(event) {
    if (event.button !== 0 || !stickerImage.current) return;
    const canvas = canvasRef.current;
    event.preventDefault();
    setDrawing(true);
    setCursor((current) => ({ ...current, visible: false }));
    canvas.setPointerCapture(event.pointerId);
    const startPoint = point(event);
    stickerDrag.current = { start: startPoint, current: startPoint, pointerId: event.pointerId };
    updateStickerPreview(event);
  }
  function start(event) {
    if (event.altKey || originalPreviewHeld) return;
    if (pendingSticker.current) {
      event.preventDefault();
      commitPendingSticker();
      return;
    }
    const canvas = canvasRef.current;
    if (event.ctrlKey || areaToolActive) {
      startAreaStroke(event);
      return;
    }
    if (stickerToolActive) {
      startStickerStroke(event);
      return;
    }
    pushHistory();
    setDrawing(true);
    canvas.setPointerCapture(event.pointerId);
    strokeMode.current = event.button === 2 ? (mode === "brush" ? "eraser" : "brush") : mode;
    strokeStamp.current = brushStamp();
    prepareStrokeEffect();
    const current = point(event);
    const lineModifierActive = shortcuts.lineModifier !== "disabled" && event[`${shortcuts.lineModifier}Key`];
    if (lineModifierActive && lastAnchor.current) { const distance = Math.hypot(current.x - lastAnchor.current.x, current.y - lastAnchor.current.y); const spacing = Math.max(1, size * .12); const steps = Math.max(1, Math.ceil(distance / spacing)); for (let index = 1; index <= steps; index += 1) dab(lastAnchor.current.x + (current.x - lastAnchor.current.x) * index / steps, lastAnchor.current.y + (current.y - lastAnchor.current.y) * index / steps); }
    else dab(current.x, current.y);
    lastPoint.current = current;
    lastAnchor.current = current;
  }
  function persist() {
    const state = saveState.current;
    state.pending = canvasRef.current.toDataURL("image/png");
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(commitPersist, 1000);
    setSaveStatus("저장 대기");
  }
  async function commitPersist() {
    const state = saveState.current;
    state.timer = null;
    if (state.inFlight || !state.pending) return;
    const dataUrl = state.pending;
    state.pending = null;
    state.inFlight = true;
    setSaveStatus("저장 중");
    let failed = false;
    try {
      const savePromise = window.aaa.assets.saveCensored(asset.id, dataUrl);
      state.activePromise = savePromise;
      await savePromise;
      onSaved?.();
      setSaveStatus(state.pending ? "저장 대기" : "저장됨");
    } catch (error) {
      failed = true;
      if (!state.pending) state.pending = dataUrl;
      setSaveStatus("저장 실패");
      onSaveError?.(`검열 이미지를 저장하지 못했습니다: ${error.message}`);
    } finally {
      state.activePromise = null;
      state.inFlight = false;
      if (state.pending && !failed) state.timer = setTimeout(commitPersist, 1000);
    }
  }
  async function flushForClose() {
    if (pendingSticker.current) commitPendingSticker();
    const state = saveState.current;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    if (state.pending) {
      const dataUrl = state.pending;
      state.pending = null;
      setSaveStatus("저장 중");
      try { await window.aaa.assets.saveCensored(asset.id, dataUrl); }
      catch (error) { state.pending = dataUrl; setSaveStatus("저장 실패"); throw error; }
      onSaved?.();
      setSaveStatus("저장됨");
      return;
    }
    if (state.activePromise) await state.activePromise;
  }
  function retrySave() { if (!saveState.current.inFlight && saveState.current.pending) commitPersist(); }
  async function resetAsset() {
    cancelPendingSticker();
    const state = saveState.current;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    state.pending = null;
    setSaveStatus("");
    await onReset?.();
    const source = await window.aaa.assets.url(asset.id, true);
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d").drawImage(image, 0, 0);
      history.current = [];
      redoHistory.current = [];
      syncHistoryAvailability();
      lastAnchor.current = null;
      lastPoint.current = null;
    };
    image.src = source;
  }
  async function markManual() {
    if (pendingSticker.current) commitPendingSticker();
    const state = saveState.current;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    if (state.pending) {
      const dataUrl = state.pending;
      state.pending = null;
      setSaveStatus("저장 중");
      try { await window.aaa.assets.saveCensored(asset.id, dataUrl); setSaveStatus("저장됨"); }
      catch (error) { state.pending = dataUrl; setSaveStatus("저장 실패"); onSaveError?.(`검열 이미지를 저장하지 못했습니다: ${error.message}`); return; }
    }
    await onMarkManual?.();
  }
  async function toggleManualReview() {
    if (asset.reviewStatus !== "manual") { await markManual(); return; }
    try {
      await flushForClose();
      await window.aaa.assets.setReview(asset.id, "unreviewed", { preserveCensored: true });
      setSaveStatus("대기로 변경됨");
      onSaved?.();
    } catch (error) {
      setSaveStatus("저장 실패");
      onSaveError?.(`검열 상태를 변경하지 못했습니다: ${error.message}`);
    }
  }
  function clearStrokeState() {
    setDrawing(false);
    setAreaPreview(null);
    setStickerPreview(null);
    areaDrag.current = null;
    stickerDrag.current = null;
    strokeEffect.current = null;
    strokeStamp.current = null;
    lastPoint.current = null;
  }
  function cancelAreaStroke(event = null) {
    const canvas = canvasRef.current;
    const pointerId = event?.pointerId ?? areaDrag.current?.pointerId;
    if (canvas && pointerId !== undefined && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    clearStrokeState();
  }
  function cancelStickerStroke(event = null) {
    const canvas = canvasRef.current;
    const pointerId = event?.pointerId ?? stickerDrag.current?.pointerId;
    if (canvas && pointerId !== undefined && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    clearStrokeState();
  }
  function finishAreaStroke(event) {
    const drag = areaDrag.current;
    if (!drag) return;
    const current = constrainedAreaPoint(drag.start, point(event), event.shiftKey);
    const bounds = normalizedAreaBounds(drag.start, current);
    if (bounds.width >= 2 && bounds.height >= 2) {
      pushHistory();
      applyArea(bounds);
      lastAnchor.current = null;
      persist();
    }
    cancelAreaStroke(event);
  }
  function finishStickerStroke(event) {
    const drag = stickerDrag.current;
    if (!drag || !stickerImage.current) return;
    const current = point(event);
    const useDefault = Math.abs(current.x - drag.start.x) < 2 && Math.abs(current.y - drag.start.y) < 2;
    const bounds = normalizedStickerBounds(drag.start, current, useDefault);
    if (bounds.width >= 2 && bounds.height >= 2) {
      setPendingSticker({ image: stickerImage.current, src: selectedSticker.previewUrl, bounds, rotation: 0 });
    }
    cancelStickerStroke(event);
  }
  function movePointer(event) {
    if (stickerDrag.current) {
      updateStickerPreview(event);
      return;
    }
    if (areaDrag.current) {
      updateAreaPreview(event);
      return;
    }
    updateCursor(event);
    applyBrush(event);
  }
  function endStroke(event) {
    if (stickerDrag.current) {
      finishStickerStroke(event);
      return;
    }
    if (areaDrag.current) {
      finishAreaStroke(event);
      return;
    }
    if (!drawing && !lastPoint.current) return;
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    lastAnchor.current = lastPoint.current;
    clearStrokeState();
    persist();
  }
  function cancelStroke(event) {
    if (stickerDrag.current) cancelStickerStroke(event);
    else if (areaDrag.current) cancelAreaStroke(event);
    else endStroke(event);
  }
  function adjustByWheel(event) { adjustByShortcut(event); }
  function adjustByShortcut(event) {
    const actions: Array<[string, () => void]> = [
      ["brushIncrease", () => setSize((value) => Math.min(240, value + 4))], ["brushDecrease", () => setSize((value) => Math.max(1, value - 4))],
      ["hardnessIncrease", () => setHardness((value) => Math.min(100, value + 5))], ["hardnessDecrease", () => setHardness((value) => Math.max(0, value - 5))],
      ["opacityIncrease", () => setOpacity((value) => Math.min(100, value + 5))], ["opacityDecrease", () => setOpacity((value) => Math.max(0, value - 5))],
      ["zoomIncrease", () => setZoom((value) => Math.min(800, value + 25))], ["zoomDecrease", () => setZoom((value) => Math.max(80, value - 25))]
    ];
    const matched = actions.find(([key]) => matchesInputShortcut(event, shortcuts[key]));
    if (!matched) return false;
    event.preventDefault(); matched[1](); return true;
  }
  function restoreHistoryImage(source, destination) {
    if (!source) return;
    const canvas = canvasRef.current;
    destination.current.push(canvas.toDataURL());
    if (destination.current.length > MAX_UNDO_HISTORY) destination.current.shift();
    syncHistoryAvailability();
    const image = new Image();
    image.onload = () => {
      canvas.getContext("2d").drawImage(image, 0, 0);
      lastAnchor.current = null;
      lastPoint.current = null;
      persist();
    };
    image.src = source;
  }
  function syncHistoryAvailability() {
    setHistoryAvailability({ undo: history.current.length > 0, redo: redoHistory.current.length > 0 });
  }
  function undo() {
    if (pendingSticker.current) { cancelPendingSticker(); return; }
    restoreHistoryImage(history.current.pop(), redoHistory);
  }
  function redo() {
    if (pendingSticker.current) { cancelPendingSticker(); return; }
    restoreHistoryImage(redoHistory.current.pop(), history);
  }

  const categoryTwemojiIds = categorizedTwemojiIds[stickerCategory] || [];
  const MethodIcon = tool === "solid" ? PaintBucket : tool === "blur" ? Droplet : Grid3X3;
  const methodLabel = tool === "solid" ? "단색" : tool === "blur" ? "블러" : "모자이크";
  const showOriginalPreview = originalPreviewHeld;
  const stickerTransformStyle = stickerTransformPreview && canvasRef.current ? {
    left: `${stickerTransformPreview.bounds.left / canvasRef.current.width * 100}%`,
    top: `${stickerTransformPreview.bounds.top / canvasRef.current.height * 100}%`,
    width: `${stickerTransformPreview.bounds.width / canvasRef.current.width * 100}%`,
    height: `${stickerTransformPreview.bounds.height / canvasRef.current.height * 100}%`,
    transform: `rotate(${stickerTransformPreview.rotation}deg)`
  } : null;
  const editor = <section className={`censor-editor ${embedded ? "embedded" : ""}`}>
    <header><div><h2>수동 검열</h2><p>{asset.relativePath}</p></div>{!embedded && <button className="modal-close" onClick={onClose}>×</button>}</header>
    <div className="editor-toolbar">
      <div className="editor-toolbar-tools">
        <div className="editor-tool-group">
          <button className={`editor-icon-button editor-tool-button brush-mode-toggle ${mode}`} aria-label={mode === "brush" ? "브러쉬" : "지우개"} data-tooltip={mode === "brush" ? "브러쉬" : "지우개"} onClick={() => { setAreaToolActive(false); setStickerToolActive(false); setMode(mode === "brush" ? "eraser" : "brush"); }}>{mode === "brush" ? <Paintbrush size={16} /> : <Eraser size={16} />}</button>
          <div className="method-settings-menu" ref={methodMenuRef}>
            <button className="editor-icon-button editor-tool-button" aria-label={methodLabel} aria-expanded={methodMenuOpen} aria-haspopup="menu" data-tooltip={methodLabel} onClick={() => { setMethodMenuOpen((current) => !current); setBrushSettingsOpen(false); }}><MethodIcon size={16} /></button>
            {methodMenuOpen && <div className="method-settings-popover" role="menu">{[["solid", "단색", PaintBucket], ["blur", "블러", Droplet], ["mosaic", "모자이크", Grid3X3]].map(([value, label, Icon]: any[]) => <button type="button" className={tool === value ? "active" : ""} role="menuitem" key={value} onClick={() => { setAreaToolActive(false); setStickerToolActive(false); setTool(value); setMethodMenuOpen(false); }}><Icon size={16} /><span>{label}</span></button>)}</div>}
          </div>
          <button className="editor-icon-button editor-tool-button" aria-label={shape === "circle" ? "원형" : "사각형"} data-tooltip={shape === "circle" ? "원형" : "사각형"} onClick={() => { setAreaToolActive(false); setStickerToolActive(false); setShape(shape === "circle" ? "square" : "circle"); }}>{shape === "circle" ? <Circle size={16} /> : <Square size={16} />}</button>
          <label className="editor-color-button" title={`브러쉬 색상 ${color}`}><input type="color" aria-label="브러쉬 색상" value={color} onChange={(event) => setColor(event.target.value)} /></label>
        </div>
        <div className="brush-settings-menu" ref={brushSettingsRef}>
          <button className={`outline-button editor-brush-summary ${brushSettingsOpen ? "active" : ""}`} aria-label="브러쉬 수치 설정" aria-expanded={brushSettingsOpen} title={`크기 ${size}px · 경도 ${hardness}% · 불투명도 ${opacity}%`} onClick={() => { setBrushSettingsOpen((current) => !current); setMethodMenuOpen(false); }}><SlidersHorizontal size={15} /><span>{areaToolActive ? "—" : size}/{hardness}/{opacity}</span></button>
          {brushSettingsOpen && <div className="brush-settings-popover">
            <label><span>크기</span><div className="number-with-unit"><input type="number" min="1" max="240" value={size} disabled={areaToolActive} onChange={(event) => setSize(Math.max(1, Math.min(240, Number(event.target.value) || 1)))} /><span>px</span></div></label>
            <label><span>경도</span><div className="number-with-unit"><input type="number" min="0" max="100" value={hardness} onChange={(event) => setHardness(Math.max(0, Math.min(100, Number(event.target.value) || 0)))} /><span>%</span></div></label>
            <label><span>불투명도</span><div className="number-with-unit"><input type="number" min="0" max="100" value={opacity} onChange={(event) => setOpacity(Math.max(0, Math.min(100, Number(event.target.value) || 0)))} /><span>%</span></div></label>
          </div>}
        </div>
        <button className={`editor-icon-button area-tool-button ${areaToolActive ? "active" : ""}`} type="button" aria-label="영역 그리기" aria-pressed={areaToolActive} data-tooltip="영역 그리기" onClick={() => { setAreaToolActive((current) => !current); setStickerToolActive(false); setStickerMenuOpen(false); setBrushSettingsOpen(false); setMethodMenuOpen(false); }}><SquareDashed size={16} /></button>
        <div className="sticker-settings-menu" ref={stickerMenuRef}>
          <button className={`editor-icon-button sticker-tool-button ${stickerToolActive ? "active" : ""}`} type="button" aria-label="스티커" aria-expanded={stickerMenuOpen} aria-haspopup="menu" data-tooltip="스티커" onClick={toggleStickerTool}><Sticker size={16} /></button>
          {stickerMenuOpen && <div className="sticker-settings-popover" role="menu">
            <div className="sticker-category-tabs" role="tablist"
              onWheel={(event) => {
                if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
                event.preventDefault();
                event.currentTarget.scrollLeft += event.deltaY || event.deltaX;
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                const tabs = event.currentTarget;
                stickerCategoryDrag.current = { pointerId: event.pointerId, startX: event.clientX, scrollLeft: tabs.scrollLeft, moved: false };
              }}
              onPointerMove={(event) => {
                const drag = stickerCategoryDrag.current;
                if (drag.pointerId !== event.pointerId) return;
                const distance = event.clientX - drag.startX;
                if (Math.abs(distance) > 4) drag.moved = true;
                if (!drag.moved) return;
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
                event.currentTarget.classList.add("dragging");
                event.currentTarget.scrollLeft = drag.scrollLeft - distance;
              }}
              onPointerUp={(event) => {
                const tabs = event.currentTarget;
                if (stickerCategoryDrag.current.pointerId !== event.pointerId) return;
                tabs.classList.remove("dragging");
                if (tabs.hasPointerCapture(event.pointerId)) tabs.releasePointerCapture(event.pointerId);
                stickerCategoryDrag.current.pointerId = null;
              }}
              onPointerCancel={(event) => {
                event.currentTarget.classList.remove("dragging");
                stickerCategoryDrag.current = { pointerId: null, startX: 0, scrollLeft: 0, moved: false };
              }}
              onClickCapture={(event) => {
                if (!stickerCategoryDrag.current.moved) return;
                event.preventDefault();
                event.stopPropagation();
                stickerCategoryDrag.current.moved = false;
              }}>
              <button type="button" role="tab" aria-label="사용자" title="사용자" aria-selected={stickerCategory === "custom"} className={`icon-only ${stickerCategory === "custom" ? "active" : ""}`} onClick={() => setStickerCategory("custom")}><Star size={15} /></button>
              {TWEMOJI_CATEGORIES.map(([value, label]) => <button type="button" role="tab" aria-selected={stickerCategory === value} className={stickerCategory === value ? "active" : ""} key={value} onClick={() => setStickerCategory(value)}>{label}</button>)}
            </div>
            <div className="sticker-picker-content">
              {stickerCategory !== "custom" && <div className="sticker-emoji-grid" ref={stickerEmojiGridRef} onScroll={(event) => {
                const list = event.currentTarget;
                if (list.scrollHeight - list.scrollTop - list.clientHeight <= 48) {
                  setEmojiLimit((current) => Math.min(current + TWEMOJI_PAGE_SIZE, categoryTwemojiIds.length));
                }
              }}>
                {categoryTwemojiIds.slice(0, emojiLimit).map((id) => {
                  const character = twemojiCharacter(id);
                  const sticker = twemojiSticker(id);
                  return <button type="button" className={`sticker-emoji-choice ${selectedSticker?.id === sticker.id ? "active" : ""}`} role="menuitem" key={id} title={`${character} · U+${id.toUpperCase().replaceAll("-", " U+")}`} onClick={() => selectSticker(sticker)}><img src={sticker.url} alt={character} loading="lazy" /></button>;
                })}
              </div>}
              {stickerCategory !== "custom" && !categoryTwemojiIds.length && <p className="sticker-empty-result">이 카테고리에 표시할 이모지가 없습니다.</p>}
              {stickerCategory === "custom" && <div className="sticker-custom-content">
                {!!favoriteEmojiIds.length && <div className="sticker-emoji-grid favorite">
                  {favoriteEmojiIds.map((id) => { const sticker = twemojiSticker(id); return <button type="button" className={`sticker-emoji-choice ${selectedSticker?.id === sticker.id ? "active" : ""}`} role="menuitem" key={id} title={sticker.name} onClick={() => selectSticker(sticker)}><img src={sticker.url} alt={sticker.name} loading="lazy" /></button>; })}
                </div>}
                {!!customStickers.length && <div className="sticker-library-grid">
                  {customStickers.map((sticker) => <div className={`sticker-library-item ${selectedSticker?.id === sticker.id ? "active" : ""}`} key={sticker.id}><button type="button" className="sticker-library-choice" role="menuitem" title={sticker.name} onClick={() => selectSticker(sticker)}><img src={sticker.url} alt="" /><span>{sticker.name}</span></button><button type="button" className="sticker-delete-button" aria-label={`${sticker.name} 삭제`} onClick={(event) => { event.stopPropagation(); setStickerMenuOpen(false); setDeleteStickerTarget(sticker); }}><Trash2 size={12} /></button></div>)}
                </div>}
                {!favoriteEmojiIds.length && !customStickers.length && <p className="sticker-empty-result">등록된 스티커가 없습니다.</p>}
              </div>}
            </div>
            <div className="sticker-popover-actions">{stickerCategory === "custom" && <button type="button" onClick={addCustomStickers}><Plus size={14} />스티커 추가</button>}</div>
            {stickerError && <p className="sticker-error">{stickerError}</p>}
          </div>}
        </div>
      </div>
      <button className={`outline-button editor-icon-button editor-actions-start ${showOriginalPreview ? "active" : ""}`} aria-label="원본 보기" data-tooltip="원본 보기" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setOriginalPreviewHeld(true); }} onPointerUp={() => setOriginalPreviewHeld(false)} onPointerCancel={() => setOriginalPreviewHeld(false)} onLostPointerCapture={() => setOriginalPreviewHeld(false)} onKeyDown={(event) => { if ([" ", "Enter"].includes(event.key)) { event.preventDefault(); setOriginalPreviewHeld(true); } }} onKeyUp={(event) => { if ([" ", "Enter"].includes(event.key)) setOriginalPreviewHeld(false); }}><Eye size={16} /></button>
      <button className="outline-button editor-icon-button" aria-label="되돌리기" data-tooltip="되돌리기" disabled={!historyAvailability.undo} onClick={undo}><Undo2 size={16} /></button>
      <button className="outline-button editor-icon-button" aria-label="다시 실행" data-tooltip="다시 실행" disabled={!historyAvailability.redo} onClick={redo}><Redo2 size={16} /></button>
      <button className="outline-button editor-icon-button" aria-label="초기화" data-tooltip="초기화" onClick={resetAsset}><RefreshCcw size={16} /></button>
      <button className="outline-button editor-icon-button" aria-label="수동완료" data-tooltip="수동완료" onClick={markManual}><Check size={17} /></button>
      {saveStatus && <span className={`editor-save-status ${saveStatus === "저장 실패" ? "error" : ""}`}>{saveStatus}</span>}
      {saveStatus === "저장 실패" && <button className="outline-button censor-save-retry" onClick={retrySave}>다시 시도</button>}
    </div>
    <div className="editor-canvas">
      {loadStatus !== "ready" && <div className={`censor-load-state ${loadStatus}`}><strong>{loadStatus === "loading" ? "이미지 불러오는 중…" : "이미지를 불러오지 못했습니다."}</strong>{loadMessage && <p>{loadMessage}</p>}{loadStatus === "error" && <button className="outline-button" onClick={() => setLoadVersion((value) => value + 1)}>다시 시도</button>}</div>}
      {loadStatus === "ready" && loadMessage && <div className="censor-load-warning">{loadMessage}<button className="text-button" onClick={() => setLoadVersion((value) => value + 1)}>다시 시도</button></div>}
      <div className="canvas-stage" style={{ visibility: loadStatus === "ready" ? "visible" : "hidden" }}>
        <canvas className={areaToolActive ? "area-tool-active" : stickerToolActive ? "sticker-tool-active" : ""} ref={canvasRef} onContextMenu={(event) => event.preventDefault()} onPointerDown={start} onPointerMove={movePointer} onPointerEnter={updateCursor} onPointerLeave={() => setCursor({ ...cursor, visible: false })} onPointerUp={endStroke} onPointerCancel={cancelStroke} />
        {areaPreview && <span className="area-draw-preview" style={areaPreview} />}
        {stickerPreview && <img className="sticker-draw-preview" src={stickerPreview.src} alt="" style={stickerPreview.style} />}
        {!showOriginalPreview && stickerTransformPreview && stickerTransformStyle && <div className="sticker-transform-preview" style={stickerTransformStyle} role="group" aria-label="배치 중인 스티커" onPointerDown={(event) => startStickerTransform(event, "move")} onPointerMove={updateStickerTransform} onPointerUp={finishStickerTransform} onPointerCancel={finishStickerTransform}>
          <img src={stickerTransformPreview.src} alt="" />
          <button type="button" className="sticker-transform-handle rotate" aria-label="스티커 회전" data-tooltip="회전" onPointerDown={(event) => startStickerTransform(event, "rotate")} onPointerMove={updateStickerTransform} onPointerUp={finishStickerTransform} onPointerCancel={finishStickerTransform}><RotateCw size={12} /></button>
          <button type="button" className="sticker-transform-handle resize" aria-label="스티커 크기 조절" data-tooltip="크기 조절" onPointerDown={(event) => startStickerTransform(event, "resize")} onPointerMove={updateStickerTransform} onPointerUp={finishStickerTransform} onPointerCancel={finishStickerTransform}><MoveDiagonal2 size={12} /></button>
        </div>}
        <canvas className={`original-preview-canvas ${showOriginalPreview ? "visible" : ""}`} ref={originalPreviewRef} aria-hidden="true" />
        <span className={`brush-preview ${shape}`} style={{ display: cursor.visible && !showOriginalPreview && !areaToolActive && !stickerToolActive && !areaPreview && !stickerPreview ? "block" : "none", width: cursor.size, height: cursor.size, left: cursor.x, top: cursor.y, background: mode === "brush" && tool === "solid" ? `${color}${Math.round(opacity * 2.55).toString(16).padStart(2, "0")}` : "transparent" }} />
      </div>
    </div>
  </section>;
  const deleteStickerModal = deleteStickerTarget && <DeleteConfirmModal title="스티커 삭제" target={deleteStickerTarget.name} busy={stickerDeleting} onClose={() => setDeleteStickerTarget(null)} onConfirm={removeCustomSticker} />;
  return embedded ? <><button className="outline-button editor-icon-button censorship-sidebar-toggle" aria-label={sidebarCollapsed ? "에셋 목록 열기" : "에셋 목록 숨기기"} data-tooltip={sidebarCollapsed ? "목록 열기" : "목록 숨기기"} onClick={() => setSidebarCollapsed((current) => !current)}>{sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>{editor}{deleteStickerModal}</> : <><div className="editor-backdrop">{editor}</div>{deleteStickerModal}</>;
}

function Censorship({ project }) {
  const [assets, setAssets] = useState([]); const [filter, setFilter] = useState("all"); const [selectedId, setSelectedId] = useState("");
  const [listEditing, setListEditing] = useState(false);
  const [listSelectedIds, setListSelectedIds] = useState([]);
  const listSelectionAnchorId = useRef<string | null>(null);
  const [listTargetStatus, setListTargetStatus] = useState("unreviewed");
  const [listEditSaving, setListEditSaving] = useState(false);
  const [listResetConfirmOpen, setListResetConfirmOpen] = useState(false);
  const [aiModal, setAiModal] = useState(false);
  const [aiScope, setAiScope] = useState("unreviewed");
  const [aiSelectedIds, setAiSelectedIds] = useState([]);
  const [aiManualSearch, setAiManualSearch] = useState("");
  const [aiSettings, setAiSettings] = useState(() => savedCensorshipSettings());
  const [aiRunning, setAiRunning] = useState(false);
  const [aiCancelling, setAiCancelling] = useState(false);
  const [aiProgress, setAiProgress] = useState(null);
  const [aiError, setAiError] = useState("");
  const [editorError, setEditorError] = useState("");
  const [aiResult, setAiResult] = useState(null);
  const [aiLogModal, setAiLogModal] = useState(false);
  const [aiCompletionLog, setAiCompletionLog] = useState(false);
  const [aiLogs, setAiLogs] = useState([]);
  const [aiLogError, setAiLogError] = useState("");
  const [aiRuntimeAvailable, setAiRuntimeAvailable] = useState(false);
  const shortcuts = savedCensorShortcuts();
  const censorshipSettings = savedCensorshipSettings();
  const [editorSettings, setEditorSettings] = useState(() => ({ mode: "brush", tool: censorshipSettings.method, shape: censorshipSettings.shape, color: censorshipSettings.color, size: censorshipSettings.size, hardness: censorshipSettings.hardness, opacity: censorshipSettings.opacity }));
  const load = () => window.aaa.assets.list(project.id).then(setAssets);
  useEffect(() => { load(); }, [project.id]);
  useEffect(() => {
    let active = true;
    const updateAvailability = (status) => { if (active) setAiRuntimeAvailable(Boolean(status?.available)); };
    const refreshAvailability = () => window.aaa.aiRuntime.status().then(updateAvailability).catch(() => updateAvailability(null));
    const handleRuntimeChange = (event) => updateAvailability(event.detail);
    refreshAvailability();
    window.addEventListener("aaa-ai-runtime-changed", handleRuntimeChange);
    return () => { active = false; window.removeEventListener("aaa-ai-runtime-changed", handleRuntimeChange); };
  }, []);
  const eligibleAssets = useMemo(() => {
    if (!project.tags.length || !project.pathTemplate) return [];
    return assets.filter((asset) => matchesProjectPath(project, asset.relativePath));
  }, [assets, project.tags, project.pathTemplate]);
  const filtered = filter === "all" ? eligibleAssets : eligibleAssets.filter((asset) => asset.reviewStatus === filter);
  const selectedFromAll = eligibleAssets.find((asset) => asset.id === selectedId);
  const visible = !listEditing && selectedFromAll && !filtered.some((asset) => asset.id === selectedFromAll.id) ? [selectedFromAll, ...filtered] : filtered;
  const selected = visible.find((asset) => asset.id === selectedId) || visible[0];
  async function selectAsset(id) {
    if (!id || id === selected?.id) return;
    try { await flushCensorEdits(); setEditorError(""); setSelectedId(id); }
    catch (error) { setEditorError(`현재 이미지 저장에 실패해 이동하지 않았습니다: ${error.message}`); }
  }
  async function changeFilter(value) {
    try { await flushCensorEdits(); setEditorError(""); setFilter(value); setSelectedId(""); }
    catch (error) { setEditorError(`현재 이미지 저장에 실패해 필터를 변경하지 않았습니다: ${error.message}`); }
  }
  useEffect(() => { if (selected?.id && selected.id !== selectedId) setSelectedId(selected.id); }, [selected?.id, selectedId]);
  useEffect(() => {
    if (listEditing || !selected?.id) return undefined;
    const frame = requestAnimationFrame(() => document.querySelector(".censorship-file-list > button.active")?.scrollIntoView({ block: "nearest", inline: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [selected?.id, listEditing, filter]);
  useEffect(() => { const listener = (event) => { if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName) || !visible.length) return; const index = Math.max(0, visible.findIndex((asset) => asset.id === selected?.id)); if (matchesInputShortcut(event, shortcuts.previous)) { event.preventDefault(); selectAsset(visible[Math.max(0, index - 1)].id); } else if (matchesInputShortcut(event, shortcuts.next)) { event.preventDefault(); selectAsset(visible[Math.min(visible.length - 1, index + 1)].id); } }; window.addEventListener("keydown", listener); window.addEventListener("wheel", listener, { passive: false }); return () => { window.removeEventListener("keydown", listener); window.removeEventListener("wheel", listener); }; }, [visible, selected?.id, shortcuts]);
  useEffect(() => window.aaa.assets.onAiProgress(setAiProgress), []);
  useEffect(() => {
    if (!aiRunning) return undefined;
    const block = (event) => { event.preventDefault(); event.stopImmediatePropagation(); };
    window.addEventListener("keydown", block, true);
    window.addEventListener("wheel", block, { capture: true, passive: false });
    return () => { window.removeEventListener("keydown", block, true); window.removeEventListener("wheel", block, true); };
  }, [aiRunning]);
  const labels = { unreviewed: "대기", auto: "자동완료", manual: "수동완료", failed: "실패" };
  const aiTargets = aiScope === "all" ? eligibleAssets : aiScope === "manual" ? eligibleAssets.filter((asset) => aiSelectedIds.includes(asset.id)) : eligibleAssets.filter((asset) => asset.reviewStatus === aiScope);
  const aiManualSearchTerm = normalizedSearchText(aiManualSearch.trim());
  const aiManualAssets = aiScope !== "manual" || !aiManualSearchTerm ? eligibleAssets : eligibleAssets.filter((asset) => normalizedSearchText(asset.relativePath).includes(aiManualSearchTerm));
  const progressPercent = !aiProgress ? 0 : aiProgress.stage === "loading" ? 5 : aiProgress.stage === "detecting" ? 10 + Math.round(55 * aiProgress.completed / Math.max(1, aiProgress.total)) : 65 + Math.round(35 * aiProgress.completed / Math.max(1, aiProgress.total));

  function openAiModal() {
    if (!aiRuntimeAvailable) return;
    setAiSettings(savedCensorshipSettings());
    setAiScope("unreviewed");
    setAiSelectedIds([]);
    setAiManualSearch("");
    setAiError("");
    setAiResult(null);
    setAiProgress(null);
    setAiModal(true);
  }

  async function openAiLogModal() {
    setAiLogError("");
    setAiCompletionLog(false);
    setAiLogModal(true);
    try { setAiLogs(await window.aaa.assets.aiLogs()); }
    catch (error) { setAiLogError(error.message); }
  }

  function closeAiLogModal() {
    setAiLogModal(false);
    if (!aiCompletionLog) return;
    setAiCompletionLog(false);
    setAiModal(false);
    setAiProgress(null);
  }

  function toggleAiSelection(id) {
    setAiSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function toggleListEditing() {
    setListEditing((current) => !current);
    setListSelectedIds([]);
    listSelectionAnchorId.current = null;
    setEditorError("");
  }

  function toggleListSelection(id, event) {
    const visibleIds = filtered.map((asset) => asset.id);
    const anchorIndex = visibleIds.indexOf(listSelectionAnchorId.current);
    const clickedIndex = visibleIds.indexOf(id);
    if (event.shiftKey && anchorIndex >= 0 && clickedIndex >= 0) {
      const start = Math.min(anchorIndex, clickedIndex);
      const end = Math.max(anchorIndex, clickedIndex);
      const rangeIds = visibleIds.slice(start, end + 1);
      setListSelectedIds((current) => [...new Set([...current, ...rangeIds])]);
      return;
    }
    listSelectionAnchorId.current = id;
    setListSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function toggleVisibleListSelection() {
    const visibleIds = filtered.map((asset) => asset.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => listSelectedIds.includes(id));
    setListSelectedIds((current) => allSelected ? current.filter((id) => !visibleIds.includes(id)) : [...new Set([...current, ...visibleIds])]);
    listSelectionAnchorId.current = null;
  }

  async function applyListStatus() {
    if (!listSelectedIds.length || listEditSaving) return;
    if (listTargetStatus === "reset") {
      setListResetConfirmOpen(true);
      return;
    }
    setListEditSaving(true);
    setEditorError("");
    try {
      await flushCensorEdits();
      await Promise.all(listSelectedIds.map((id) => window.aaa.assets.setReview(id, listTargetStatus, listTargetStatus === "unreviewed" ? { preserveCensored: true } : undefined)));
      await load();
      setSelectedId("");
      setListSelectedIds([]);
      listSelectionAnchorId.current = null;
    } catch (error) { setEditorError(`상태를 변경하지 못했습니다: ${error.message}`); }
    finally { setListEditSaving(false); }
  }

  async function resetSelectedWork() {
    if (!listSelectedIds.length || listEditSaving) return;
    setListEditSaving(true);
    setEditorError("");
    try {
      await flushCensorEdits();
      await Promise.all(listSelectedIds.map((id) => window.aaa.assets.setReview(id, "unreviewed", { preserveCensored: false })));
      await load();
      setSelectedId("");
      setListSelectedIds([]);
      listSelectionAnchorId.current = null;
      setListTargetStatus("unreviewed");
    } catch (error) { setEditorError(`작업을 초기화하지 못했습니다: ${error.message}`); }
    finally {
      setListEditSaving(false);
      setListResetConfirmOpen(false);
    }
  }

  async function startAiCensorship() {
    if (!aiTargets.length) { setAiError("작업할 이미지를 선택해 주세요."); return; }
    if (!Array.isArray(aiSettings.targets) || !aiSettings.targets.length) { setAiError("검열 대상을 하나 이상 선택해 주세요."); return; }
    if (!aiSettings.modelPath?.toLowerCase().endsWith(".pt")) { setAiError("설정에서 .pt 모델 파일을 지정해 주세요."); return; }
    setAiError("");
    setAiResult(null);
    setAiRunning(true);
    setAiProgress({ stage: "loading", completed: 0, total: aiTargets.length, message: "AI 모델 불러오는 중" });
    try {
      const result = await window.aaa.assets.aiCensor({ projectId: project.id, assetIds: aiTargets.map((asset) => asset.id), settings: aiSettings });
      setAiResult(result);
      await load();
    } catch (reason) { setAiError(reason.message); }
    finally {
      setAiCancelling(false);
      setAiLogError("");
      try { setAiLogs(await window.aaa.assets.aiLogs()); }
      catch (error) { setAiLogError(error.message); }
      setAiCompletionLog(true);
      setAiLogModal(true);
      setAiRunning(false);
    }
  }

  async function cancelAiCensorship() {
    if (!aiRunning || aiCancelling) return;
    setAiCancelling(true);
    setAiProgress((current) => ({ ...(current || {}), message: "AI 검열 작업 취소 중" }));
    try { await window.aaa.assets.cancelAi(); }
    catch (reason) { setAiError(reason.message); setAiCancelling(false); }
  }

  const visibleListIds = filtered.map((asset) => asset.id);
  const allVisibleListSelected = visibleListIds.length > 0 && visibleListIds.every((id) => listSelectedIds.includes(id));

  return <><div className="censorship-workspace"><aside className="censorship-sidebar"><div><div className="ai-censorship-actions"><button className="primary-button full" disabled={!aiRuntimeAvailable} title={aiRuntimeAvailable ? "" : "AI 검열 패키지가 설치되어 있지 않습니다."} onClick={openAiModal}>AI 검열</button><button className="outline-button ai-log-button" aria-label="AI 검열 로그" data-tooltip="로그" onClick={openAiLogModal}><ScrollText size={17} /></button></div>{editorError && <p className="error">{editorError}</p>}</div><div className="censorship-list-tools"><div className="censorship-list-filter"><select aria-label="검열 상태 필터" value={filter} disabled={listEditSaving} onChange={(event) => changeFilter(event.target.value)}><option value="all">전체</option><option value="unreviewed">대기</option><option value="auto">자동완료</option><option value="manual">수동완료</option><option value="failed">실패</option></select><button className={`outline-button censorship-list-edit-button ${listEditing ? "active" : ""}`} aria-label={listEditing ? "목록 편집 종료" : "목록 편집"} data-tooltip={listEditing ? "편집 종료" : "편집"} disabled={listEditSaving} onClick={toggleListEditing}>{listEditing ? <X size={17} /> : <Pencil size={16} />}</button></div>{listEditing && <div className="censorship-bulk-editor"><button className="outline-button censorship-select-all-button" aria-label={allVisibleListSelected ? "현재 목록 전체 선택 해제" : "현재 목록 전체 선택"} title={allVisibleListSelected ? "전체 선택 해제" : "전체 선택"} disabled={!visibleListIds.length || listEditSaving} onClick={toggleVisibleListSelection}><span className={`censorship-list-check ${allVisibleListSelected ? "checked" : ""}`}>{allVisibleListSelected && <Check size={12} />}</span></button><select aria-label="변경할 검열 상태 또는 작업" value={listTargetStatus} disabled={listEditSaving} onChange={(event) => setListTargetStatus(event.target.value)}><option value="unreviewed">대기</option><option value="auto">자동완료</option><option value="manual">수동완료</option><option value="failed">실패</option><option value="reset">작업 초기화</option></select><button className="primary-button" disabled={!listSelectedIds.length || listEditSaving} onClick={applyListStatus}>변경</button></div>}</div><div className={`censorship-file-list ${listEditing ? "editing" : ""}`}>{visible.map((asset) => { const checked = listSelectedIds.includes(asset.id); return <button className={listEditing ? (checked ? "active" : "") : selected?.id === asset.id ? "active" : ""} key={asset.id} onClick={(event) => listEditing ? toggleListSelection(asset.id, event) : selectAsset(asset.id)}>{listEditing ? <span className={`censorship-list-check ${checked ? "checked" : ""}`}>{checked && <Check size={12} />}</span> : <span className={`review-dot ${asset.reviewStatus}`} />}<span>{asset.relativePath}</span><small>{labels[asset.reviewStatus]}</small></button>; })}</div></aside><main className="censorship-main">{selected ? <ManualCensorEditor key={selected.id} asset={selected} project={project} editorSettings={editorSettings} onEditorSettingsChange={setEditorSettings} embedded onSaved={load} onSaveError={setEditorError} onReset={async () => { await window.aaa.assets.setReview(selected.id, "unreviewed"); await load(); }} onMarkManual={async () => { await window.aaa.assets.setReview(selected.id, "manual"); await load(); }} /> : <div className="empty-state">이미지가 없습니다.</div>}</main></div>
    {listResetConfirmOpen && <div className="modal-backdrop"><section className="modal delete-modal"><div className="modal-heading"><h2>작업 초기화</h2><button className="modal-close icon-button" aria-label="닫기" disabled={listEditSaving} onClick={() => setListResetConfirmOpen(false)}><X size={18} /></button></div><p><strong>선택한 에셋 {listSelectedIds.length}개</strong><span>상태와 자동·수동 검열 결과를 모두 원본 상태로 초기화합니다.</span><span>이 작업은 되돌릴 수 없습니다.</span></p><div className="modal-actions"><button className="text-button" disabled={listEditSaving} onClick={() => setListResetConfirmOpen(false)}>취소</button><button className="danger-button" disabled={listEditSaving} onClick={resetSelectedWork}>{listEditSaving ? "초기화 중…" : "작업 초기화"}</button></div></section></div>}
    {aiLogModal && <div className={`modal-backdrop ai-log-backdrop ${aiCompletionLog ? "completion" : ""}`} onMouseDown={(event) => { if (!aiCompletionLog && event.target === event.currentTarget) closeAiLogModal(); }}>{aiCompletionLog && <div className="ai-window-drag-region" aria-hidden="true" />}<section className="modal ai-log-modal">
      <div className="modal-heading"><h2>{aiCompletionLog ? "AI 검열 작업 로그" : "AI 검열 로그"}</h2>{!aiCompletionLog && <button className="modal-close" onClick={closeAiLogModal}>×</button>}</div>
      {aiLogError ? <p className="error">{aiLogError}</p> : aiLogs.length ? <div className="ai-log-list">{[...aiLogs].reverse().map((entry) => <div className={`ai-log-entry ${entry.level}`} key={entry.id}><time>{aiLogTime(entry.timestamp)}</time><span>{entry.message}</span></div>)}</div> : <div className="empty-state">로그가 없습니다.</div>}
      {aiCompletionLog && <div className="modal-actions"><button className="primary-button" onClick={closeAiLogModal}>확인</button></div>}
    </section></div>}
    {aiModal && <div className={`modal-backdrop ai-censorship-backdrop ${aiRunning || aiCompletionLog ? "privacy" : ""}`} onMouseDown={(event) => { if (!aiRunning && !aiCompletionLog && event.target === event.currentTarget) setAiModal(false); }}>{(aiRunning || aiCompletionLog) && <div className="ai-window-drag-region" aria-hidden="true" />}<section className="modal ai-censorship-modal">
      <div className="modal-heading"><h2>AI 검열 작업</h2>{!aiRunning && !aiCompletionLog && <button className="modal-close" onClick={() => setAiModal(false)}>×</button>}</div>
      {aiRunning || aiCompletionLog ? <div className="ai-job-progress"><strong>{aiProgress?.message || "작업 준비 중"}</strong><div className="progress-track"><div className="progress-fill censorship" style={{ width: `${progressPercent}%` }} /></div><span>{progressPercent}%</span><p>{aiCompletionLog ? "작업이 종료되었습니다." : aiCancelling ? "실행 중인 AI 프로세스를 종료하고 있습니다." : "AI 검열 작업을 진행하고 있습니다."}</p>{aiRunning && <button className="danger-button" disabled={aiCancelling} onClick={cancelAiCensorship}>{aiCancelling ? "취소 중" : "작업 취소"}</button>}</div> : <>
        <section className="ai-job-section"><h3>작업 범위</h3><div className="ai-scope-layout">
          <div className="ai-scope-panel"><label className="ai-scope-field"><select aria-label="작업 범위" value={aiScope} onChange={(event) => setAiScope(event.target.value)}><option value="all">전체 ({eligibleAssets.length})</option><option value="unreviewed">대기 중 ({eligibleAssets.filter((asset) => asset.reviewStatus === "unreviewed").length})</option><option value="failed">실패 ({eligibleAssets.filter((asset) => asset.reviewStatus === "failed").length})</option><option value="manual">수동 선택 ({aiSelectedIds.length})</option></select></label><p className="ai-selection-count">선택된 이미지 {aiTargets.length}개</p></div>
          <div className="ai-file-picker">{aiScope === "manual" && <div className="ai-file-picker-search"><Search size={15} aria-hidden="true" /><input aria-label="수동 선택 파일 검색" placeholder="파일 검색" value={aiManualSearch} onChange={(event) => setAiManualSearch(event.target.value)} /></div>}{(aiScope === "manual" ? aiManualAssets : aiTargets).length ? (aiScope === "manual" ? aiManualAssets.map((asset) => <div className="ai-file-picker-row selectable" key={asset.id} onClick={() => toggleAiSelection(asset.id)}><input type="checkbox" aria-label={`${asset.relativePath} 선택`} checked={aiSelectedIds.includes(asset.id)} onClick={(event) => event.stopPropagation()} onChange={() => toggleAiSelection(asset.id)} /><span>{asset.relativePath}</span><small className={asset.reviewStatus}>{labels[asset.reviewStatus]}</small></div>) : aiTargets.map((asset) => <div className="ai-file-picker-row" key={asset.id}><i className="ai-checkbox-placeholder" aria-hidden="true" /><span>{asset.relativePath}</span><small className={asset.reviewStatus}>{labels[asset.reviewStatus]}</small></div>)) : <div className="ai-file-picker-empty">{aiScope === "manual" && aiManualSearch.trim() ? "검색 결과가 없습니다." : "파일이 없습니다."}</div>}</div>
        </div></section>
        <section className="ai-job-section"><h3>모델 설정</h3><div className="ai-settings-grid">
          <label className="wide">검열 대상<div className="target-options">{CENSOR_TARGET_OPTIONS.map(([value, label]) => {
            const selected = aiSettings.targets?.includes(value);
            return <button type="button" className={selected ? "active" : ""} key={value} onClick={() => setAiSettings((current) => ({ ...current, targets: selected ? current.targets.filter((item) => item !== value) : [...(current.targets || []), value] }))}>{label}</button>;
          })}</div></label>
          <label className="wide">모델 파일<div className="directory-field"><input readOnly value={aiSettings.modelPath || ""} /><button className="outline-button" onClick={async () => { const modelPath = await window.aaa.chooseModel(); if (modelPath) setAiSettings({ ...aiSettings, modelPath }); }}>찾아보기</button></div></label>
          <label>입력 해상도<input type="number" min="320" max="4096" step="32" value={aiSettings.imageSize || 1024} onChange={(event) => setAiSettings({ ...aiSettings, imageSize: Math.max(320, Math.min(4096, Number(event.target.value) || 1024)) })} /></label>
          <label>탐지 신뢰도<div className="number-with-unit"><input type="number" min="1" max="100" value={aiSettings.confidence || 50} onChange={(event) => setAiSettings({ ...aiSettings, confidence: Math.max(1, Math.min(100, Number(event.target.value) || 1)) })} /><span>%</span></div></label>
        </div></section>
        <section className="ai-job-section"><h3>브러쉬 설정</h3><div className="ai-settings-grid">
          <label>방식<select value={aiSettings.method} onChange={(event) => setAiSettings({ ...aiSettings, method: event.target.value })}><option value="solid">단색</option><option value="blur">블러</option><option value="mosaic">모자이크</option></select></label>
          <label onClick={(event) => { if (!(event.target as Element).closest(".brush-color-control")) event.preventDefault(); }}>색상<div className={`brush-color-control ${aiSettings.method !== "solid" ? "disabled" : ""}`}><span aria-hidden="true"><Palette size={17} /></span><input type="color" aria-label="AI 검열 브러쉬 색상" disabled={aiSettings.method !== "solid"} value={aiSettings.color} onChange={(event) => setAiSettings({ ...aiSettings, color: event.target.value })} /></div></label>
          <label>경도<div className="number-with-unit"><input type="number" min="0" max="100" value={aiSettings.hardness} onChange={(event) => setAiSettings({ ...aiSettings, hardness: Math.max(0, Math.min(100, Number(event.target.value) || 0)) })} /><span>%</span></div></label>
          <label>불투명도<div className="number-with-unit"><input type="number" min="0" max="100" value={aiSettings.opacity} onChange={(event) => setAiSettings({ ...aiSettings, opacity: Math.max(0, Math.min(100, Number(event.target.value) || 0)) })} /><span>%</span></div></label>
          <label>마스크 확장<div className="number-with-unit"><input type="number" min="0" max="100" value={aiSettings.dilation || 0} onChange={(event) => setAiSettings({ ...aiSettings, dilation: Math.max(0, Math.min(100, Number(event.target.value) || 0)) })} /><span>px</span></div></label>
        </div></section>
        {aiResult && <p className="success">완료 · 성공 {aiResult.succeeded}개 · 실패 {aiResult.failed}개</p>}{aiError && <p className="error">{aiError}</p>}
        <div className="modal-actions"><button className="text-button" onClick={() => setAiModal(false)}>닫기</button><button className="primary-button" disabled={!aiTargets.length} onClick={startAiCensorship}>작업 시작</button></div>
      </>}
    </section></div>}
  </>;
}

export { Censorship };
