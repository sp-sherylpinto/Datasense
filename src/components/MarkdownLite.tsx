import React from 'react';

/**
 * Tiny markdown renderer for the AI Insight panels.
 *
 * The AI emits a small subset of markdown — paragraphs, `**bold**`, and
 * `- ` bullet lists. We hand-roll instead of pulling in `react-markdown`
 * (~150 KB with deps) since the input is well-controlled and we just spent
 * Phase 2 shrinking the bundle.
 *
 * Inline patterns supported:
 *   **bold**           → <strong>
 *   `code`             → <code>
 *
 * Block patterns supported:
 *   `- item`           → bullet list
 *   `1. item`          → ordered list
 *   blank line         → paragraph break
 */

const renderInline = (text: string, keyPrefix: string): React.ReactNode[] => {
  // Walk the string finding **bold** and `code` spans; everything else is text.
  const out: React.ReactNode[] = [];
  const pattern = /\*\*([^*]+?)\*\*|`([^`]+?)`/g;
  const matches = Array.from(text.matchAll(pattern));
  let cursor = 0;
  matches.forEach((m, idx) => {
    const start = m.index ?? 0;
    if (start > cursor) {
      out.push(text.slice(cursor, start));
    }
    if (m[1] !== undefined) {
      out.push(
        <strong key={`${keyPrefix}-b-${idx}`} className="text-tx font-semibold">
          {m[1]}
        </strong>
      );
    } else if (m[2] !== undefined) {
      out.push(
        <code key={`${keyPrefix}-c-${idx}`} className="font-mono text-[11px] bg-sub/60 px-1 py-0.5 rounded">
          {m[2]}
        </code>
      );
    }
    cursor = start + m[0].length;
  });
  if (cursor < text.length) {
    out.push(text.slice(cursor));
  }
  return out;
};

interface Props {
  /** Markdown text. Supports `\n` and `\\n` (the SSE escape) interchangeably. */
  text: string;
}

export const MarkdownLite = ({ text }: Props) => {
  // Reverse the SSE newline-escape and split into lines.
  const normalised = text.replace(/\\n/g, '\n');
  const lines = normalised.split(/\r?\n/);

  const blocks: React.ReactNode[] = [];
  let i = 0;
  let blockKey = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (trimmed === '') {
      i++;
      continue;
    }

    // Bullet list (`- foo` or `* foo`).
    const bulletMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      const items: string[] = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        const bm = t.match(/^[-*]\s+(.*)$/);
        if (!bm) break;
        items.push(bm[1]);
        i++;
      }
      blocks.push(
        <ul key={`b${blockKey++}`} className="list-disc list-outside pl-5 space-y-1 my-2">
          {items.map((it, ix) => (
            <li key={ix}>{renderInline(it, `b${blockKey}-${ix}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list (`1. foo`).
    const orderedMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      const items: string[] = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        const om = t.match(/^\d+\.\s+(.*)$/);
        if (!om) break;
        items.push(om[1]);
        i++;
      }
      blocks.push(
        <ol key={`b${blockKey++}`} className="list-decimal list-outside pl-5 space-y-1 my-2">
          {items.map((it, ix) => (
            <li key={ix}>{renderInline(it, `b${blockKey}-${ix}`)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Plain paragraph: collect consecutive non-blank, non-bullet lines.
    const paraLines: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      const t = l.trim();
      if (t === '' || /^[-*]\s+/.test(t) || /^\d+\.\s+/.test(t)) break;
      paraLines.push(l);
      i++;
    }
    const paraText = paraLines.join(' ');
    blocks.push(
      <p key={`b${blockKey++}`} className="my-2 leading-relaxed">
        {renderInline(paraText, `b${blockKey}`)}
      </p>
    );
  }

  return <div className="text-[12px] text-tx2">{blocks}</div>;
};
