import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Play, Terminal as TerminalIcon, X, XCircle } from 'lucide-react';
import type { SelfCheckReport, TerminalEntry } from '../shared/types';

interface TerminalDrawerProps {
  entries: TerminalEntry[];
  lastReport: SelfCheckReport | null;
  runningSelfCheck: boolean;
  onRunCommand: (command: string) => Promise<void>;
  onRunSelfCheck: () => Promise<void>;
  onClose: () => void;
}

const ENTRY_COLOR: Record<TerminalEntry['type'], string> = {
  info: 'text-slate-400',
  command: 'text-blue-300 font-semibold',
  stdout: 'text-slate-200',
  stderr: 'text-red-400',
  permission: 'text-amber-300',
  success: 'text-emerald-400',
  action: 'text-sky-300',
  hook: 'text-violet-300',
};

export function TerminalDrawer({
  entries,
  lastReport,
  runningSelfCheck,
  onRunCommand,
  onRunSelfCheck,
  onClose,
}: TerminalDrawerProps) {
  const [cmdInput, setCmdInput] = useState('');
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries.length]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = cmdInput.trim();
    if (!trimmed) return;
    setCmdInput('');
    await onRunCommand(trimmed);
  };

  return (
    <section
      aria-label="Terminal Sandbox et Self-Check"
      className="flex h-[260px] shrink-0 flex-col border-t border-slate-800 bg-[#070A10]"
    >
      {/* Terminal header */}
      <div className="flex h-10 shrink-0 items-center justify-between gap-4 border-b border-slate-800/90 bg-[#0F1520] px-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-200 whitespace-nowrap">
            <TerminalIcon className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            <span>Terminal Sandbox</span>
          </div>
          {lastReport && (
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-medium tabular-nums whitespace-nowrap ${
                lastReport.allPassed ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {lastReport.allPassed ? (
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>
                Self-Check : {lastReport.passedCount}/{lastReport.totalCount} PASS
              </span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void onRunCommand('ls')}
            className="rounded border border-slate-700 bg-[#0B0F17] px-2 py-1 font-mono text-[11px] text-slate-300 transition-colors hover:border-slate-600 hover:text-white whitespace-nowrap"
          >
            ls
          </button>
          <button
            type="button"
            disabled={runningSelfCheck}
            onClick={() => void onRunSelfCheck()}
            className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 whitespace-nowrap"
          >
            <Play className="h-3 w-3" aria-hidden="true" />
            <span>{runningSelfCheck ? 'Test en cours...' : 'Lancer Self-Check'}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer le terminal"
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Log output */}
      <div className="flex-1 overflow-y-auto px-4 py-2.5 font-mono text-[12px] leading-relaxed">
        {entries.map((entry) => (
          <div key={entry.id} className={`whitespace-pre-wrap ${ENTRY_COLOR[entry.type]}`}>
            {entry.text}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>

      {/* Command input */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-slate-800/80 bg-[#0B0F17] px-4 py-1.5"
      >
        <span className="font-mono text-xs text-blue-400" aria-hidden="true">
          $
        </span>
        <input
          type="text"
          value={cmdInput}
          onChange={(e) => setCmdInput(e.target.value)}
          aria-label="Commande terminal sandbox"
          placeholder="Entrez une commande (ls, cat agents.md, node hello.js, self-check, help)..."
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-slate-100 placeholder-slate-500 outline-none"
        />
        <button
          type="submit"
          className="rounded px-2.5 py-1 text-[11px] font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white whitespace-nowrap shrink-0"
        >
          Exécuter
        </button>
      </form>
    </section>
  );
}
