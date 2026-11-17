import { useEffect, useState } from 'react';
import { Play, Save, ShieldCheck, X } from 'lucide-react';

interface FileInspectorProps {
  mode: 'file' | 'system-prompt';
  filePath: string | null;
  content: string;
  saving: boolean;
  onSaveFile: (path: string, nextContent: string) => Promise<void>;
  onRunJsFile: (path: string) => Promise<void>;
  onClose: () => void;
}

export function FileInspector({
  mode,
  filePath,
  content,
  saving,
  onSaveFile,
  onRunJsFile,
  onClose,
}: FileInspectorProps) {
  const [draft, setDraft] = useState(content);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraft(content);
    setDirty(false);
  }, [content, filePath, mode]);

  const isJsFile = Boolean(filePath && /\.(js|mjs)$/i.test(filePath));

  return (
    <section
      aria-label={mode === 'system-prompt' ? 'Prompt système actif' : `Éditeur ${filePath}`}
      className="fixed inset-x-0 bottom-0 top-14 z-30 flex flex-col border-l border-slate-800/90 bg-[#0F1520] lg:static lg:inset-auto lg:z-auto lg:h-full lg:w-[440px] xl:w-[500px] shrink-0"
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-slate-800/90 px-4">
        <div className="flex min-w-0 items-center gap-2">
          {mode === 'system-prompt' && (
            <ShieldCheck className="h-4 w-4 shrink-0 text-blue-400" aria-hidden="true" />
          )}
          <h2 className="truncate font-mono text-[13px] font-medium text-white">
            {mode === 'system-prompt' ? 'Prompt système actif' : filePath}
          </h2>
          {dirty && mode === 'file' && (
            <span className="text-[11px] text-amber-300 whitespace-nowrap">· Modifié</span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {mode === 'file' && isJsFile && filePath && (
            <button
              type="button"
              onClick={() => onRunJsFile(filePath)}
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-[#0B0F17] px-2.5 py-1 text-xs font-medium text-slate-200 transition-colors hover:border-slate-600 hover:text-white whitespace-nowrap"
            >
              <Play className="h-3 w-3 text-emerald-400" aria-hidden="true" />
              <span>Exécuter</span>
            </button>
          )}
          {mode === 'file' && filePath && (
            <button
              type="button"
              disabled={saving || !dirty}
              onClick={() => onSaveFile(filePath, draft)}
              className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40 whitespace-nowrap"
            >
              <Save className="h-3 w-3" aria-hidden="true" />
              <span>{saving ? 'Enregistrement...' : 'Enregistrer'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer l'inspecteur"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-3">
        {mode === 'system-prompt' ? (
          <div className="h-full overflow-y-auto rounded-lg border border-slate-800 bg-[#0B0F17] p-4">
            <p className="mb-3 text-xs text-slate-400">
              Ce bloc est généré dynamiquement à chaque requête vers Gemini (modèle actif, OS, date et règles de <code className="font-mono text-slate-300">agents.md</code>).
            </p>
            <pre className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-slate-200">
              {content}
            </pre>
          </div>
        ) : (
          <textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setDirty(true);
            }}
            aria-label={`Contenu du fichier ${filePath}`}
            spellCheck={false}
            className="h-full w-full resize-none rounded-lg border border-slate-800 bg-[#0B0F17] p-3.5 font-mono text-[12.5px] leading-relaxed text-slate-200 outline-none focus:border-blue-500"
          />
        )}
      </div>
    </section>
  );
}
