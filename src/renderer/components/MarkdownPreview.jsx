import { useEffect, useState } from "react";
import { ImageOff, X } from "lucide-react";

function splitTableRow(line) {
  const source = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let cell = "";
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "|" && source[index - 1] !== "\\") {
      cells.push(cell.trim());
      cell = "";
    } else if (source[index] === "|" && source[index - 1] === "\\") {
      cell = `${cell.slice(0, -1)}|`;
    } else {
      cell += source[index];
    }
  }
  cells.push(cell.trim());
  return cells;
}

function MarkdownImage({ source, alt, title, basePath }) {
  const directSource = /^(?:https?:\/\/|data:image\/|blob:|aaa-asset:\/\/)/i.test(source);
  const [resolvedSource, setResolvedSource] = useState(directSource ? source : "");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    if (directSource) {
      setResolvedSource(source);
      return () => { active = false; };
    }
    setResolvedSource("");
    window.aaa.markdown.imageDataUrl(source, basePath)
      .then((value) => { if (active) setResolvedSource(value); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [source, basePath, directSource]);

  if (failed) return <span className="markdown-image-error"><ImageOff size={18} />{alt || "이미지를 불러올 수 없습니다."}</span>;
  if (!resolvedSource) return <span className="markdown-image-loading">이미지 불러오는 중…</span>;
  return <img src={resolvedSource} alt={alt} title={title || undefined} loading="lazy" onError={() => setFailed(true)} />;
}

function renderInline(value, keyPrefix, basePath) {
  const pattern = /(!\[[^\]]*\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\[[^\]]+\]\((?:https?:\/\/|mailto:)[^)]+\)|\*[^*\n]+\*|_[^_\n]+_)/g;
  const nodes = [];
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    if (match.index > cursor) nodes.push(value.slice(cursor, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (token.startsWith("![")) {
      const image = /^!\[([^\]]*)\]\((?:<([^>]+)>|(\S+?))(?:\s+["']([^"']*)["'])?\)$/.exec(token);
      nodes.push(image ? <MarkdownImage key={key} source={image[2] || image[3]} alt={image[1]} title={image[4]} basePath={basePath} /> : token);
    } else if (token.startsWith("`")) nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("**") || token.startsWith("__")) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("~~")) nodes.push(<del key={key}>{token.slice(2, -2)}</del>);
    else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      nodes.push(<a key={key} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>);
    } else nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    cursor = match.index + token.length;
  }
  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

function isTableDivider(line) {
  const cells = splitTableRow(line);
  return line.includes("|") && cells.length > 1 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function startsBlock(lines, index) {
  const line = lines[index] || "";
  return /^\s*(```|~~~)/.test(line)
    || /^\s{0,3}#{1,6}\s+/.test(line)
    || /^\s*>/.test(line)
    || /^\s*(?:[-*+]\s+|\d+\.\s+)/.test(line)
    || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)
    || (index + 1 < lines.length && line.includes("|") && isTableDivider(lines[index + 1]));
}

function MarkdownPreview({ content, basePath = "" }) {
  const lines = content.replaceAll("\r\n", "\n").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    const fence = /^\s*(```|~~~)\s*([^\s]*)/.exec(line);
    if (fence) {
      const code = [];
      const marker = fence[1];
      index += 1;
      while (index < lines.length && !new RegExp(`^\\s*${marker}`).test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push(<pre key={`code-${index}`}><code data-language={fence[2] || undefined}>{code.join("\n")}</code></pre>);
      continue;
    }

    const heading = /^\s{0,3}(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const Heading = `h${heading[1].length}`;
      blocks.push(<Heading key={`heading-${index}`}>{renderInline(heading[2], `heading-${index}`, basePath)}</Heading>);
      index += 1;
      continue;
    }

    if (index + 1 < lines.length && line.includes("|") && isTableDivider(lines[index + 1])) {
      const headers = splitTableRow(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(splitTableRow(lines[index++]));
      blocks.push(<div className="markdown-preview-table-wrap" key={`table-${index}`}><table><thead><tr>{headers.map((cell, cellIndex) => <th key={cellIndex}>{renderInline(cell, `th-${index}-${cellIndex}`, basePath)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, cellIndex) => <td key={cellIndex}>{renderInline(row[cellIndex] || "", `td-${index}-${rowIndex}-${cellIndex}`, basePath)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={`hr-${index}`} />);
      index += 1;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/, ""));
      blocks.push(<blockquote key={`quote-${index}`}>{quote.map((item, quoteIndex) => <span key={quoteIndex}>{renderInline(item, `quote-${index}-${quoteIndex}`, basePath)}{quoteIndex < quote.length - 1 && <br />}</span>)}</blockquote>);
      continue;
    }

    const list = /^\s*(?:(\d+)\.|[-*+])\s+(.+)$/.exec(line);
    if (list) {
      const ordered = Boolean(list[1]);
      const items = [];
      const expression = ordered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
      while (index < lines.length) {
        const item = expression.exec(lines[index]);
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(<List key={`list-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, `list-${index}-${itemIndex}`, basePath)}</li>)}</List>);
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !startsBlock(lines, index)) paragraph.push(lines[index++]);
    if (!paragraph.length) paragraph.push(lines[index++]);
    blocks.push(<p key={`paragraph-${index}`}>{paragraph.map((item, lineIndex) => <span key={lineIndex}>{renderInline(item, `paragraph-${index}-${lineIndex}`, basePath)}{lineIndex < paragraph.length - 1 && <br />}</span>)}</p>);
  }

  return <article className="markdown-rendered-preview">{blocks.length ? blocks : <p className="markdown-preview-empty">미리 볼 내용이 없습니다.</p>}</article>;
}

function MarkdownPreviewModal({ title, content, basePath, onClose }) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="modal markdown-preview-modal">
      <div className="modal-heading"><h2>{title || "시작 상황 미리보기"}</h2><button className="modal-close icon-button" aria-label="닫기" onClick={onClose}><X size={18} /></button></div>
      <MarkdownPreview content={content} basePath={basePath} />
    </section>
  </div>;
}

export { MarkdownPreview, MarkdownPreviewModal };
