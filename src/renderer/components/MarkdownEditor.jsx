import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Table2, X } from "lucide-react";

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function markMatches(markup, selectedText) {
  if (!selectedText || selectedText.length > 100) return markup;
  const expression = new RegExp(escapeRegularExpression(escapeHtml(selectedText)), "g");
  return markup.split(/(<[^>]+>)/g).map((part) => part.startsWith("<") ? part : part.replace(expression, '<mark class="prompt-match">$&</mark>')).join("");
}

function highlightLine(line, selectedText) {
  let markup = escapeHtml(line);
  markup = markup.replace(/^(\s*)(#{1,6}\s+.*)$/, '$1<span class="md-heading">$2</span>');
  markup = markup.replace(/^(\s*)(&gt;)(\s?)/, '$1<span class="md-quote">$2</span>$3');
  markup = markup.replace(/^(\s*)([-*+]|\d+\.)(\s)/, '$1<span class="md-list">$2</span>$3');
  markup = markup.replace(/^(\s*)(```|~~~)/, '$1<span class="md-fence">$2</span>');
  return markMatches(markup, selectedText);
}

function splitTableRow(line) {
  const source = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let cell = "";
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "|" && source[index - 1] !== "\\") { cells.push(cell.trim()); cell = ""; }
    else if (source[index] === "|" && source[index - 1] === "\\") cell = `${cell.slice(0, -1)}|`;
    else cell += source[index];
  }
  cells.push(cell.trim());
  return cells;
}

function findMarkdownTable(content, position) {
  const lines = content.split("\n");
  const offsets = [];
  let offset = 0;
  lines.forEach((line) => { offsets.push(offset); offset += line.length + 1; });
  const lineIndex = Math.max(0, offsets.findLastIndex((lineOffset) => lineOffset <= position));
  const isTableLine = (line) => /^\s*\|.*\|\s*$/.test(line);
  if (!isTableLine(lines[lineIndex])) return null;
  let first = lineIndex;
  let last = lineIndex;
  while (first > 0 && isTableLine(lines[first - 1])) first -= 1;
  while (last < lines.length - 1 && isTableLine(lines[last + 1])) last += 1;
  const block = lines.slice(first, last + 1);
  const dividerIndex = block.findIndex((line) => splitTableRow(line).every((cell) => /^:?-+:?$/.test(cell)));
  if (dividerIndex !== 1) return null;
  const headers = splitTableRow(block[0]);
  const rows = block.slice(2).map(splitTableRow).map((row) => Array.from({ length: headers.length }, (_, index) => row[index] || ""));
  return { start: offsets[first], end: offsets[last] + lines[last].length, headers, rows: rows.length ? rows : [Array(headers.length).fill("")] };
}

function MarkdownTableDialog({ initialTable, onClose, onInsert }) {
  const [columns, setColumns] = useState(initialTable?.headers.length || 3);
  const [rows, setRows] = useState(initialTable?.rows.length || 3);
  const [headers, setHeaders] = useState(initialTable?.headers || ["열 1", "열 2", "열 3"]);
  const [body, setBody] = useState(initialTable?.rows || Array.from({ length: 3 }, () => ["", "", ""]));
  function resize(nextColumns, nextRows) { setHeaders((current) => Array.from({ length: nextColumns }, (_, index) => current[index] ?? `열 ${index + 1}`)); setBody((current) => Array.from({ length: nextRows }, (_, rowIndex) => Array.from({ length: nextColumns }, (_, columnIndex) => current[rowIndex]?.[columnIndex] ?? ""))); }
  function changeColumns(value) { const next = Math.max(1, Math.min(99, Number(value) || 1)); setColumns(next); resize(next, rows); }
  function changeRows(value) { const next = Math.max(1, Math.min(99, Number(value) || 1)); setRows(next); resize(columns, next); }
  function updateHeader(index, value) { setHeaders((current) => current.map((cell, cellIndex) => cellIndex === index ? value : cell)); }
  function updateCell(rowIndex, columnIndex, value) { setBody((current) => current.map((row, currentRow) => currentRow === rowIndex ? row.map((cell, currentColumn) => currentColumn === columnIndex ? value : cell) : row)); }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal markdown-table-modal" onSubmit={(event) => { event.preventDefault(); onInsert(headers, body); }} onKeyDown={(event) => event.key === "Enter" && event.target.classList.contains("markdown-table-cell-input") && event.preventDefault()}><div className="modal-heading"><h2>마크다운 표 {initialTable ? "편집" : "삽입"}</h2><button type="button" className="modal-close icon-button" aria-label="닫기" onClick={onClose}><X size={18} /></button></div><div className="markdown-table-options"><label>열 수<input type="number" min="1" max="99" value={columns} onChange={(event) => changeColumns(event.target.value)} /></label><label>데이터 행 수<input type="number" min="1" max="99" value={rows} onChange={(event) => changeRows(event.target.value)} /></label></div><p className="markdown-table-help">표에서 내용을 바로 입력하세요. 기존 표는 해당 표 위에서 우클릭한 뒤 ‘표 편집’을 선택하여 편집할 수 있습니다.</p><div className="markdown-table-preview" style={{ gridTemplateColumns: `repeat(${columns}, minmax(180px, 1fr))` }}>{headers.map((cell, index) => <input autoFocus={index === 0} className="markdown-table-cell-input header" aria-label={`제목 ${index + 1}`} key={`header-${index}`} value={cell} onChange={(event) => updateHeader(index, event.target.value)} />)}{body.flatMap((row, rowIndex) => row.map((cell, columnIndex) => <input className="markdown-table-cell-input" aria-label={`${rowIndex + 1}행 ${columnIndex + 1}열`} key={`cell-${rowIndex}-${columnIndex}`} value={cell} onChange={(event) => updateCell(rowIndex, columnIndex, event.target.value)} />))}</div><div className="modal-actions"><button type="button" className="text-button" onClick={onClose}>취소</button><button className="primary-button button-with-icon"><Table2 size={15} />표 {initialTable ? "적용" : "삽입"}</button></div></form></div>;
}

const MarkdownEditor = forwardRef(function MarkdownEditor({ value, onChange, bottomPanel = null, footerItems = [] }, ref) {
  const [selection, setSelection] = useState({ length: 0 });
  const [cursorWord, setCursorWord] = useState("");
  const [tableDialog, setTableDialog] = useState(null);
  const [tableContextMenu, setTableContextMenu] = useState(null);
  const editorInput = useRef(null);
  const codeView = useRef(null);
  const tableSelection = useRef({ start: 0, end: 0 });

  function updateSelection({ highlightWord = false } = {}) {
    const input = editorInput.current;
    if (!input) return;
    const { selectionStart: start, selectionEnd: end, value: inputValue } = input;
    setSelection({ length: end - start });
    if (!highlightWord || start !== end) { setCursorWord(""); return; }
    const isWordCharacter = (character) => /[\p{L}\p{N}_-]/u.test(character);
    let left = start; let right = start;
    if (!isWordCharacter(inputValue[right]) && isWordCharacter(inputValue[left - 1])) left -= 1;
    if (!isWordCharacter(inputValue[left])) { setCursorWord(""); return; }
    while (left > 0 && isWordCharacter(inputValue[left - 1])) left -= 1;
    while (right < inputValue.length && isWordCharacter(inputValue[right])) right += 1;
    setCursorWord(inputValue.slice(left, right));
  }

  function openTableDialog() { const input = editorInput.current; tableSelection.current = input ? { start: input.selectionStart, end: input.selectionEnd } : { start: value.length, end: value.length }; setTableDialog({}); }
  useImperativeHandle(ref, () => ({ openTableDialog, focus: () => editorInput.current?.focus() }), [value]);

  function insertMarkdownTable(headers, rows) {
    const { start, end } = tableSelection.current;
    const before = value.slice(0, start); const after = value.slice(end); const editing = Boolean(tableDialog?.headers);
    const leadingBreak = editing || !before ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const trailingBreak = editing || !after ? "" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
    const compactCell = (cell) => cell.trim().replaceAll("|", "\\|").replaceAll("\n", " ");
    const table = `|${headers.map(compactCell).join("|")}|\n|${headers.map(() => "-").join("|")}|\n${rows.map((row) => `|${row.map(compactCell).join("|")}|`).join("\n")}`;
    onChange(`${before}${leadingBreak}${table}${trailingBreak}${after}`); setTableDialog(null);
    const firstHeaderStart = start + leadingBreak.length + 1;
    requestAnimationFrame(() => { editorInput.current?.focus(); editorInput.current?.setSelectionRange(firstHeaderStart, firstHeaderStart + headers[0].trim().length); updateSelection(); });
  }

  function handleKeyDown(event) {
    if (event.key !== "Tab") return;
    event.preventDefault(); const { selectionStart, selectionEnd, value: inputValue } = event.currentTarget;
    onChange(`${inputValue.slice(0, selectionStart)}  ${inputValue.slice(selectionEnd)}`);
    requestAnimationFrame(() => editorInput.current?.setSelectionRange(selectionStart + 2, selectionStart + 2));
  }

  function showTableContextMenu(event) { const table = findMarkdownTable(value, event.currentTarget.selectionStart); if (!table) return; event.preventDefault(); setTableContextMenu({ x: Math.min(event.clientX, window.innerWidth - 150), y: Math.min(event.clientY, window.innerHeight - 54), table }); }
  useEffect(() => { if (!tableContextMenu) return undefined; const close = () => setTableContextMenu(null); const escape = (event) => event.key === "Escape" && close(); window.addEventListener("pointerdown", close); window.addEventListener("keydown", escape); window.addEventListener("blur", close); return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", escape); window.removeEventListener("blur", close); }; }, [tableContextMenu]);
  const lines = value.split("\n");
  return <><div className="prompt-editor-body"><pre ref={codeView} className="prompt-code-view" aria-hidden="true">{lines.map((line, index) => <span className="prompt-code-row" key={index}><span className="prompt-line-number">{index + 1}</span><span className="prompt-code-content" dangerouslySetInnerHTML={{ __html: highlightLine(line || " ", cursorWord) }} /></span>)}</pre><textarea ref={editorInput} value={value} onChange={(event) => { onChange(event.target.value); updateSelection(); }} onKeyDown={handleKeyDown} onContextMenu={showTableContextMenu} onSelect={() => updateSelection()} onKeyUp={() => updateSelection()} onMouseUp={() => requestAnimationFrame(() => updateSelection({ highlightWord: true }))} onScroll={() => { const input = editorInput.current; if (codeView.current && input) codeView.current.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`; }} spellCheck="false" /></div>{bottomPanel}<footer className="prompt-status-bar"><span className="prompt-status-language">Markdown</span>{footerItems}<span>전체 {value.length.toLocaleString()}자</span><span>선택 {selection.length.toLocaleString()}자</span></footer>{tableContextMenu && <div className="prompt-table-context-menu" style={{ left: tableContextMenu.x, top: tableContextMenu.y }} onPointerDown={(event) => event.stopPropagation()}><button className="button-with-icon" onClick={() => { const table = tableContextMenu.table; tableSelection.current = { start: table.start, end: table.end }; setTableContextMenu(null); setTableDialog(table); }}><Table2 size={15} />표 편집</button></div>}{tableDialog && <MarkdownTableDialog initialTable={tableDialog.headers ? tableDialog : null} onClose={() => setTableDialog(null)} onInsert={insertMarkdownTable} />}</>;
});

export { MarkdownEditor };
