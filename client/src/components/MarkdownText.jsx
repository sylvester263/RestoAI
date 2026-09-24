/**
 * MarkdownText — renders the small Markdown subset AI replies actually use
 * (bold, italic, inline code, headings, bullet/numbered lists, paragraphs).
 *
 * Builds React elements rather than HTML strings, so model output can never
 * inject markup — anything unrecognised is shown as plain text.
 */

const INLINE_RE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

function renderInline(text, keyPrefix) {
  return text.split(INLINE_RE).filter(Boolean).map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) {
      return <strong key={key} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={key} className="rounded bg-black/5 px-1 text-[0.9em] dark:bg-white/10">{part.slice(1, -1)}</code>;
    }
    if (part.length > 2 && ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_')))) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

const BULLET_RE = /^\s*[-*•]\s+(.*)$/;
const NUMBERED_RE = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING_RE = /^\s*#{1,6}\s+(.*)$/;

export default function MarkdownText({ text, className = '' }) {
  if (!text) return null;
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let para = [];
  let list = null; // { ordered, items }

  const flushPara = () => {
    if (para.length) blocks.push({ type: 'p', lines: para });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: 'list', ...list });
    list = null;
  };

  for (const line of lines) {
    const bullet = line.match(BULLET_RE);
    const numbered = line.match(NUMBERED_RE);
    const heading = line.match(HEADING_RE);
    if (bullet || numbered) {
      flushPara();
      const ordered = !!numbered;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(numbered ? numbered[2] : bullet[1]);
    } else if (heading) {
      flushPara();
      flushList();
      blocks.push({ type: 'h', text: heading[1] });
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();

  return (
    <div className={`space-y-2 ${className}`}>
      {blocks.map((b, i) => {
        if (b.type === 'h') return <p key={i} className="font-semibold">{renderInline(b.text, i)}</p>;
        if (b.type === 'list') {
          const Tag = b.ordered ? 'ol' : 'ul';
          return (
            <Tag key={i} className={`space-y-1 pl-5 ${b.ordered ? 'list-decimal' : 'list-disc'}`}>
              {b.items.map((item, j) => <li key={j}>{renderInline(item, `${i}-${j}`)}</li>)}
            </Tag>
          );
        }
        return (
          <p key={i}>
            {b.lines.map((l, j) => (
              <span key={j}>{j > 0 && <br />}{renderInline(l, `${i}-${j}`)}</span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
