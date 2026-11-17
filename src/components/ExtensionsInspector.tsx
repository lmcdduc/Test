import { CheckCircle2, Circle, Play, Plug, Sparkles, Webhook, X } from 'lucide-react';
import type { HookRule, McpServerConfig, SpecTaskItem } from '../shared/types';

interface ExtensionsInspectorProps {
  mode: 'spec' | 'mcp-hooks';
  specTasks: SpecTaskItem[];
  hooks: HookRule[];
  mcpServers: McpServerConfig[];
  sending: boolean;
  onBuildNextSpecTask: (nextTask: SpecTaskItem | undefined) => Promise<void>;
  onToggleHook: (hookId: string) => Promise<void>;
  onToggleMcp: (serverId: string) => Promise<void>;
  onTestMcpTool: (toolName: string) => Promise<void>;
  onOpenSpecFile: () => Promise<void>;
  onClose: () => void;
}

export function ExtensionsInspector({
  mode,
  specTasks,
  hooks,
  mcpServers,
  sending,
  onBuildNextSpecTask,
  onToggleHook,
  onToggleMcp,
  onTestMcpTool,
  onOpenSpecFile,
  onClose,
}: ExtensionsInspectorProps) {
  const completedCount = specTasks.filter((t) => t.completed).length;
  const nextPending = specTasks.find((t) => !t.completed);

  return (
    <section
      aria-label={mode === 'spec' ? 'Spec et Plan de build' : 'Serveurs MCP et Hooks'}
      className="fixed inset-x-0 bottom-0 top-14 z-30 flex flex-col border-l border-slate-800/90 bg-[#0F1520] lg:static lg:inset-auto lg:z-auto lg:h-full lg:w-[440px] xl:w-[500px] shrink-0"
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-slate-800/90 px-4">
        <div className="flex min-w-0 items-center gap-2">
          {mode === 'spec' ? (
            <Sparkles className="h-4 w-4 shrink-0 text-blue-400" aria-hidden="true" />
          ) : (
            <Plug className="h-4 w-4 shrink-0 text-blue-400" aria-hidden="true" />
          )}
          <h2 className="truncate font-display text-[13px] font-semibold text-white">
            {mode === 'spec' ? 'Spec & Plan (spec.md)' : 'Serveurs MCP & Hooks'}
          </h2>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {mode === 'spec' && (
            <button
              type="button"
              onClick={() => void onOpenSpecFile()}
              className="rounded-md border border-slate-700 bg-[#0B0F17] px-2.5 py-1 text-xs font-medium text-slate-300 hover:border-slate-600 hover:text-white whitespace-nowrap"
            >
              Éditer spec.md
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

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {mode === 'spec' ? (
          <>
            <div className="rounded-xl border border-slate-800 bg-[#0B0F17] p-4 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-300">Avancement du plan</span>
                <span className="font-mono tabular-nums text-slate-200">
                  {completedCount}/{specTasks.length} validées
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-blue-500 transition-all"
                  style={{
                    width: `${specTasks.length ? Math.round((completedCount / specTasks.length) * 100) : 0}%`,
                  }}
                />
              </div>
              <button
                type="button"
                disabled={sending || !nextPending}
                onClick={() => void onBuildNextSpecTask(nextPending)}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
              >
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {nextPending
                    ? 'Construire la prochaine étape de spec.md'
                    : 'Toutes les étapes sont terminées'}
                </span>
              </button>
            </div>

            <div className="space-y-2.5">
              {specTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-start gap-2.5 rounded-lg border border-slate-800/80 bg-[#0B0F17] p-3"
                >
                  {task.completed ? (
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400"
                      aria-hidden="true"
                    />
                  ) : (
                    <Circle
                      className="mt-0.5 h-4 w-4 shrink-0 text-slate-500"
                      aria-hidden="true"
                    />
                  )}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-[11px] text-slate-400">{task.phase}</p>
                    <p
                      className={`text-[13px] leading-snug ${
                        task.completed ? 'text-slate-300' : 'font-medium text-white'
                      }`}
                    >
                      {task.title}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            {/* MCP Servers */}
            <section aria-labelledby="mcp-section-title" className="space-y-3">
              <div>
                <h3 id="mcp-section-title" className="font-display text-xs font-semibold text-white">
                  Serveurs MCP (Model Context Protocol)
                </h3>
                <p className="mt-0.5 text-[12px] text-slate-400">
                  Outils contextuels accessibles à l’agent via <code className="font-mono text-slate-300">mcp_call</code>.
                </p>
              </div>

              <div className="space-y-2.5">
                {mcpServers.map((server) => (
                  <div
                    key={server.id}
                    className="rounded-xl border border-slate-800 bg-[#0B0F17] p-3.5 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-white">{server.name}</p>
                        <p className="mt-0.5 text-[12px] leading-snug text-slate-400">
                          {server.description}
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={server.enabled}
                        aria-label={`Activer ou désactiver ${server.name}`}
                        onClick={() => void onToggleMcp(server.id)}
                        className={`shrink-0 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                          server.enabled
                            ? 'border-emerald-600/50 bg-emerald-600/15 text-emerald-300'
                            : 'border-slate-700 bg-slate-900 text-slate-400'
                        }`}
                      >
                        {server.enabled ? 'Actif' : 'Inactif'}
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-2">
                      <span className="font-mono text-[11px] text-slate-400">
                        Outil : {server.tools.join(', ')}
                      </span>
                      <button
                        type="button"
                        disabled={!server.enabled}
                        aria-label={`Tester l'outil ${server.tools[0]}`}
                        onClick={() => void onTestMcpTool(server.tools[0])}
                        className="rounded border border-slate-700 bg-[#111827] px-2.5 py-1 text-[11px] font-medium text-slate-200 transition-colors hover:border-slate-600 hover:text-white disabled:opacity-40 whitespace-nowrap"
                      >
                        Tester
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Lifecycle Hooks */}
            <section aria-labelledby="hooks-section-title" className="space-y-3">
              <div className="flex items-center gap-2">
                <Webhook className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                <h3 id="hooks-section-title" className="font-display text-xs font-semibold text-white">
                  Hooks Pré / Post-Outils
                </h3>
              </div>

              <div className="space-y-2.5">
                {hooks.map((hook) => (
                  <div
                    key={hook.id}
                    className="flex items-start justify-between gap-3 rounded-xl border border-slate-800 bg-[#0B0F17] p-3.5"
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="text-[13px] font-medium text-white">{hook.name}</p>
                      <p className="font-mono text-[11px] text-slate-400">
                        Événement : {hook.event}
                      </p>
                      <p className="text-[12px] leading-snug text-slate-400">{hook.description}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={hook.enabled}
                      aria-label={`Activer ou désactiver ${hook.name}`}
                      onClick={() => void onToggleHook(hook.id)}
                      className={`shrink-0 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                        hook.enabled
                          ? 'border-blue-500/60 bg-blue-600/15 text-blue-200'
                          : 'border-slate-700 bg-slate-900 text-slate-400'
                      }`}
                    >
                      {hook.enabled ? 'Actif' : 'Inactif'}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </section>
  );
}
