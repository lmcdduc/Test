import { useState } from 'react';
import {
  FileCode2,
  FilePlus2,
  Flame,
  ListChecks,
  MessageSquare,
  Plug,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import type {
  ChatSession,
  HookRule,
  McpServerConfig,
  SpecTaskItem,
  WorkspaceFileEntry,
} from '../shared/types';

interface SidebarProps {
  sessions: ChatSession[];
  activeSessionId: string;
  files: WorkspaceFileEntry[];
  activeFilePath: string | null;
  inspectorMode: 'file' | 'system-prompt' | 'spec' | 'mcp-hooks' | null;
  specTasks: SpecTaskItem[];
  hooks: HookRule[];
  mcpServers: McpServerConfig[];
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onOpenFile: (filePath: string) => void;
  onCreateFile: (filePath: string) => Promise<void>;
  onOpenSystemPrompt: () => void;
  onOpenSpecPanel: () => void;
  onOpenMcpHooksPanel: () => void;
}

export function Sidebar({
  sessions,
  activeSessionId,
  files,
  activeFilePath,
  inspectorMode,
  specTasks,
  hooks,
  mcpServers,
  mobileOpen,
  onCloseMobile,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onOpenFile,
  onCreateFile,
  onOpenSystemPrompt,
  onOpenSpecPanel,
  onOpenMcpHooksPanel,
}: SidebarProps) {
  const [creatingFile, setCreatingFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);

  const specDone = specTasks.filter((t) => t.completed).length;
  const activeMcpCount = mcpServers.filter((s) => s.enabled).length;
  const activeHookCount = hooks.filter((h) => h.enabled).length;

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newFileName.trim();
    if (!cleaned) {
      setFileError('Entrez un nom de fichier (ex: notes.md).');
      return;
    }
    setFileError(null);
    await onCreateFile(cleaned);
    setNewFileName('');
    setCreatingFile(false);
  };

  const sidebarContent = (
    <aside
      aria-label="Navigation et fichiers du projet"
      className="flex h-full w-[264px] shrink-0 flex-col border-r border-slate-800/90 bg-[#0F1520]"
    >
      {/* Brand header */}
      <div className="flex h-14 items-center justify-between border-b border-slate-800/90 px-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-600/20 text-blue-400">
            <Flame className="h-4 w-4" aria-hidden="true" />
          </div>
          <span className="font-display text-[15px] font-bold tracking-tight text-white whitespace-nowrap">
            Kiln Studio
          </span>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Fermer le panneau latéral"
          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Primary New Chat action */}
      <div className="p-3">
        <button
          type="button"
          onClick={() => {
            onNewSession();
            onCloseMobile();
          }}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-[13px] font-medium text-white transition-colors hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 whitespace-nowrap"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>Nouveau chat</span>
        </button>
      </div>

      {/* Scrollable Sessions + Files */}
      <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-6">
        {/* Sessions list */}
        <section aria-labelledby="sessions-heading">
          <h2
            id="sessions-heading"
            className="px-2 pb-1.5 text-[11px] font-medium tracking-wide text-slate-400"
          >
            Sessions ({sessions.length})
          </h2>
          <ul className="space-y-1">
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId;
              return (
                <li key={session.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      onSelectSession(session.id);
                      onCloseMobile();
                    }}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex flex-1 min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors ${
                      isActive
                        ? 'bg-slate-800/90 font-medium text-white'
                        : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
                    }`}
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                    <span className="truncate">{session.title}</span>
                  </button>
                  {sessions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onDeleteSession(session.id)}
                      aria-label={`Supprimer la session ${session.title}`}
                      className="rounded p-1.5 text-slate-500 opacity-0 transition-opacity hover:bg-slate-800 hover:text-red-400 group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {/* Workspace Explorer */}
        <section aria-labelledby="workspace-heading">
          <div className="flex items-center justify-between px-2 pb-1.5">
            <h2 id="workspace-heading" className="text-[11px] font-medium tracking-wide text-slate-400">
              Workspace ({files.length})
            </h2>
            <button
              type="button"
              onClick={() => {
                setCreatingFile((v) => !v);
                setFileError(null);
              }}
              aria-label="Créer un nouveau fichier dans le workspace"
              className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
            >
              <FilePlus2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {creatingFile && (
            <form onSubmit={handleCreateSubmit} className="mb-2 space-y-1.5 px-1">
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  placeholder="ex: notes.md"
                  aria-label="Nom du nouveau fichier"
                  autoFocus
                  className="min-w-0 flex-1 rounded-md border border-slate-700 bg-[#0B0F17] px-2 py-1 font-mono text-xs text-slate-100 outline-none focus:border-blue-500"
                />
                <button
                  type="submit"
                  className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500 whitespace-nowrap shrink-0"
                >
                  Créer
                </button>
              </div>
              {fileError && <p className="text-[11px] text-red-400">{fileError}</p>}
            </form>
          )}

          <ul className="space-y-0.5">
            {files.map((file) => {
              const isSelected = inspectorMode === 'file' && activeFilePath === file.path;
              return (
                <li key={file.path}>
                  <button
                    type="button"
                    onClick={() => {
                      onOpenFile(file.path);
                      onCloseMobile();
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                      isSelected
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <FileCode2 className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                      <span className="truncate font-mono text-[12px]">{file.path}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-500">
                      {file.size} B
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {/* Architecture Agent Controls */}
      <div className="border-t border-slate-800/90 p-3 space-y-1.5">
        <button
          type="button"
          onClick={() => {
            onOpenSpecPanel();
            onCloseMobile();
          }}
          className={`flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left text-[12px] transition-colors ${
            inspectorMode === 'spec'
              ? 'border-blue-500/60 bg-blue-600/10 text-blue-200'
              : 'border-slate-800 bg-[#0B0F17] text-slate-300 hover:border-slate-700 hover:text-white'
          }`}
        >
          <span className="flex items-center gap-2 truncate">
            <ListChecks className="h-4 w-4 shrink-0 text-blue-400" aria-hidden="true" />
            <span className="truncate">Spec & Plan</span>
          </span>
          <span className="font-mono text-[11px] tabular-nums text-slate-400 shrink-0">
            {specDone}/{specTasks.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            onOpenMcpHooksPanel();
            onCloseMobile();
          }}
          className={`flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left text-[12px] transition-colors ${
            inspectorMode === 'mcp-hooks'
              ? 'border-blue-500/60 bg-blue-600/10 text-blue-200'
              : 'border-slate-800 bg-[#0B0F17] text-slate-300 hover:border-slate-700 hover:text-white'
          }`}
        >
          <span className="flex items-center gap-2 truncate">
            <Plug className="h-4 w-4 shrink-0 text-blue-400" aria-hidden="true" />
            <span className="truncate">MCP & Hooks</span>
          </span>
          <span className="font-mono text-[11px] tabular-nums text-slate-400 shrink-0">
            {activeMcpCount}M · {activeHookCount}H
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            onOpenSystemPrompt();
            onCloseMobile();
          }}
          className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[12px] transition-colors ${
            inspectorMode === 'system-prompt'
              ? 'border-blue-500/60 bg-blue-600/10 text-blue-200'
              : 'border-slate-800 bg-[#0B0F17] text-slate-300 hover:border-slate-700 hover:text-white'
          }`}
        >
          <ShieldCheck className="h-4 w-4 shrink-0 text-blue-400" aria-hidden="true" />
          <span className="truncate">Prompt système actif</span>
        </button>
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden h-full lg:block">{sidebarContent}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{sidebarContent}</div>
        </div>
      )}
    </>
  );
}
