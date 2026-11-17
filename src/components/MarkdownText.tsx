import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface MarkdownTextProps {
  content: string;
}

interface Segment {
  type: 'text' | 'code';
  lang?: string;
  body: string;
}

function parseCodeFences(input: string): Segment[] {
  const segments: Segment[] = [];
  const regex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(input)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', body: input.slice(lastIndex, match.index) });
    }
    segments.push({
      type: 'code',
      lang: match[1] || 'text',
      body: match[2].replace(/\n$/, ''),
    });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < input.length) {
    segments.push({ type: 'text', body: input.slice(lastIndex) });
  }
  return segments;
}

function renderInlineFormatting(line: string) {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-slate-100">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={idx}
          className="rounded bg-slate-800/90 px-1.5 py-0.5 font-mono text-[0.85em] text-blue-200"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

function CodeBlock({ lang, body }: { lang: string; body: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard may be unavailable in restricted contexts
    }
  };

  return (
    <div className="my-2.5 overflow-hidden rounded-lg border border-slate-800 bg-[#070A10]">
      <div className="flex items-center justify-between border-b border-slate-800/80 px-3 py-1.5 text-xs text-slate-400">
        <span className="font-mono">{lang}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`Copier le bloc ${lang}`}
          className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          <span>{copied ? 'Copié' : 'Copier'}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[13px] leading-relaxed text-slate-200">
        <code>{body}</code>
      </pre>
    </div>
  );
}

export function MarkdownText({ content }: MarkdownTextProps) {
  const segments = parseCodeFences(content);

  return (
    <div className="space-y-2 text-[14px] leading-relaxed text-slate-200">
      {segments.map((seg, i) => {
        if (seg.type === 'code') {
          return <CodeBlock key={i} lang={seg.lang ?? 'text'} body={seg.body} />;
        }
        const paragraphs = seg.body.split('\n');
        return (
          <div key={i} className="space-y-1.5">
            {paragraphs.map((line, j) => {
              if (!line.trim()) return <div key={j} className="h-1" />;
              if (line.startsWith('### ')) {
                return (
                  <h4 key={j} className="pt-1 font-display text-sm font-semibold text-white">
                    {renderInlineFormatting(line.slice(4))}
                  </h4>
                );
              }
              if (line.startsWith('## ')) {
                return (
                  <h3 key={j} className="pt-1.5 font-display text-base font-semibold text-white">
                    {renderInlineFormatting(line.slice(3))}
                  </h3>
                );
              }
              if (line.startsWith('- ')) {
                return (
                  <div key={j} className="flex gap-2 pl-1">
                    <span className="text-slate-500" aria-hidden="true">
                      •
                    </span>
                    <p className="flex-1">{renderInlineFormatting(line.slice(2))}</p>
                  </div>
                );
              }
              return <p key={j}>{renderInlineFormatting(line)}</p>;
            })}
          </div>
        );
      })}
    </div>
  );
}
