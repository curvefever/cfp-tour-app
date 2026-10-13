/**
 * The light formatting of a tournament's rules text: paragraphs, line breaks, "- " bullet lists, **bold** and
 * [text](https://link) links. The text is parsed into plain data and rendered as React elements, never as HTML:
 * anything that is not one of these constructs, including raw HTML and links that are not http(s), stays plain text.
 */

export type RulesInline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'link'; text: string; href: string };

export type RulesBlock =
  { kind: 'paragraph'; lines: RulesInline[][] } | { kind: 'list'; items: RulesInline[][] };

// A construct is the earliest of: **bold**, or [text](http(s) address without spaces or a closing bracket).
const INLINE_PATTERN = /\*\*([^*\n]+?)\*\*|\[([^\]\n]+)\]\((https?:\/\/[^\s()]+)\)/g;

export function parseRulesInline(line: string): RulesInline[] {
  const parts: RulesInline[] = [];
  let last = 0;
  for (const match of line.matchAll(INLINE_PATTERN)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ kind: 'text', text: line.slice(last, start) });
    if (match[1] !== undefined) parts.push({ kind: 'bold', text: match[1] });
    else parts.push({ kind: 'link', text: match[2], href: match[3] });
    last = start + match[0].length;
  }
  if (last < line.length) parts.push({ kind: 'text', text: line.slice(last) });
  return parts;
}

const BULLET = /^- (.*)$/;

export function parseRulesText(text: string): RulesBlock[] {
  const blocks: RulesBlock[] = [];
  let paragraph: RulesInline[][] | null = null;
  let list: RulesInline[][] | null = null;
  const close = () => {
    if (paragraph) blocks.push({ kind: 'paragraph', lines: paragraph });
    if (list) blocks.push({ kind: 'list', items: list });
    paragraph = null;
    list = null;
  };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      close();
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      if (paragraph) close();
      list ??= [];
      list.push(parseRulesInline(bullet[1]));
    } else {
      if (list) close();
      paragraph ??= [];
      paragraph.push(parseRulesInline(line));
    }
  }
  close();
  return blocks;
}
