import { useRef, useState } from "react";

const KEYWORDS = new Set(["async", "await", "break", "case", "catch", "class", "const", "continue", "default", "delete", "do", "else", "export", "extends", "finally", "for", "from", "function", "if", "import", "in", "instanceof", "let", "new", "of", "return", "static", "switch", "throw", "try", "typeof", "var", "while", "yield"]);
const LITERALS = new Set(["true", "false", "null", "undefined", "NaN"]);

function highlightJavaScript(line) {
  const parts = [];
  let index = 0;
  const push = (text, className = "") => parts.push(<span className={className} key={`${index}-${parts.length}`}>{text}</span>);
  while (index < line.length) {
    if (line.startsWith("//", index)) { push(line.slice(index), "js-comment"); break; }
    const character = line[index];
    if (["'", '"', "`"].includes(character)) {
      let end = index + 1;
      while (end < line.length) { if (line[end] === character && line[end - 1] !== "\\") { end += 1; break; } end += 1; }
      push(line.slice(index, end), "js-string"); index = end; continue;
    }
    const number = /^\d+(?:\.\d+)?/.exec(line.slice(index));
    if (number) { push(number[0], "js-number"); index += number[0].length; continue; }
    const word = /^[A-Za-z_$][\w$]*/.exec(line.slice(index));
    if (word) {
      const className = KEYWORDS.has(word[0]) ? "js-keyword" : LITERALS.has(word[0]) ? "js-literal" : "";
      push(word[0], className); index += word[0].length; continue;
    }
    push(character, "{}()[].,;:+-*/%=<>!?&|".includes(character) ? "js-operator" : ""); index += 1;
  }
  return parts.length ? parts : " ";
}

function JavaScriptEditor({ value, onChange, inputRef, readOnly = false }) {
  const [selectionLength, setSelectionLength] = useState(0);
  const codeView = useRef(null);
  const lines = value.split("\n");
  function updateSelection(input) { setSelectionLength(input.selectionEnd - input.selectionStart); }
  function handleKeyDown(event) {
    if (event.key !== "Tab" || readOnly) return;
    event.preventDefault();
    const { selectionStart, selectionEnd } = event.currentTarget;
    onChange(`${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`);
    requestAnimationFrame(() => { event.currentTarget.setSelectionRange(selectionStart + 2, selectionStart + 2); });
  }
  return <div className="js-editor"><div className="prompt-editor-body js-editor-body"><pre ref={codeView} className="prompt-code-view" aria-hidden="true">{lines.map((line, index) => <span className="prompt-code-row" key={index}><span className="prompt-line-number">{index + 1}</span><span className="prompt-code-content">{highlightJavaScript(line)}</span></span>)}</pre><textarea ref={inputRef} readOnly={readOnly} value={value} onChange={(event) => { onChange(event.target.value); updateSelection(event.target); }} onSelect={(event) => updateSelection(event.currentTarget)} onKeyDown={handleKeyDown} onScroll={(event) => { if (codeView.current) codeView.current.style.transform = `translate(${-event.currentTarget.scrollLeft}px, ${-event.currentTarget.scrollTop}px)`; }} placeholder="JavaScript 문법으로 작성하세요." spellCheck="false" /></div><footer className="prompt-status-bar"><span className="prompt-status-language">JavaScript</span><span>전체 {value.length.toLocaleString()}자</span><span>선택 {selectionLength.toLocaleString()}자</span></footer></div>;
}

export { JavaScriptEditor };
