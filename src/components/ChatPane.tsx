import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  Bot,
  Check,
  Minimize2,
  RotateCcw,
  ShieldAlert,
  Wrench,
  X,
} from 'lucide-react';
import type { ChatMessage, PendingPermission, ToolCallLog } from '../shared/types';
import { MarkdownText } from './MarkdownText';

interface ChatPaneProps {
  messages: ChatMessage[];
  activeModel: string;
  sending: boolean;
  pendingPermission: PendingPermission | null;
  resolvingPermission: boolean;
  onSendMessage: (text: string) => Promise<void>;
  onResolvePermission: (permissionId: string, decision: 'approve' | 'deny') => Promise<void>;
}

const SLASH_COMMANDS = [
  {
    cmd: '/compact',
    desc: 'Condenser l’historique de conversation en un résumé technique',
  },
  {
    cmd: '/self-check',
    desc: 'Exécuter la suite de 12 tests automatisés dans le terminal',
  },
  {
    cmd: '/spec',
    desc: 'Demander à Kiln de lire spec.md et construire la prochaine étape',
  },
  {
    cmd: '/audit',
    desc: 'Déléguer un audit du workspace à un sous-agent spécialisé',
  },
];

const TOOL_STATUS_LABEL: Record<ToolCallLog['status'], { text: string; tone: string }> = {
  executed: { text: 'Exécuté', tone: 'text-emerald-400' },
  approved: { text: 'Autorisé', tone: 'text-emerald-400' },
  denied: { text: 'Refusé', tone: 'text-red-400' },
  pending: { text: 'En attente', tone: 'text-amber-400' },
  error: { text: 'Erreur', tone: 'text-red-400' },
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function ChatPane({
  messages,
  activeModel,
  sending,
  pendingPermission,
  resolvingPermission,
  onSendMessage,
  onResolvePermission,
}: ChatPaneProps) {
  const [input, setInput] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, pendingPermission?.id, sending]);

  const showSlashMenu = input.startsWith('/') && !input.includes(' ') && !sending && !pendingPermission;
  const matchingCommands = showSlashMenu
    ? SLASH_COMMANDS.filter((c) => c.cmd.startsWith(input.toLowerCase()))
    : [];

  const submitText = async (rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed) {
      setValidationError('Saisissez une instruction ou une commande (ex: /compact).');
      return;
    }
    setValidationError(null);
    setInput('');
    await onSendMessage(trimmed);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending || pendingPermission) return;
    await submitText(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sending && !pendingPermission) {
        void submitText(input);
      }
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-[#0B0F17]">
      {/* Message stream */}
      <div
        className="flex-1 overflow-y-auto px-4 py-6 sm:px-8"
        role="log"
        aria-label="Historique de la conversation Kiln"
      >
        <div className="mx-auto max-w-3xl space-y-5">
          {messages.map((msg, msgIdx) => {
            const isUser = msg.role === 'user';
            const previousUserMessage = msg.isError
              ? [...messages.slice(0, msgIdx)].reverse().find((m) => m.role === 'user')
              : undefined;
            return (
              <article
                key={msg.id}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
              >
                {/* Unboxed quiet metadata */}
                <div className="mb-1.5 flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="font-medium text-slate-300">
                    {isUser ? 'Vous' : msg.isCompactSummary ? 'Kiln · Synthèse /compact' : 'Kiln'}
                  </span>
                  {!isUser && msg.model && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{msg.model}</span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <time className="tabular-nums">{formatTime(msg.timestamp)}</time>
                </div>

                <div
                  className={`max-w-[92%] rounded-xl px-4 py-3 sm:max-w-[85%] ${
                    isUser
                      ? 'bg-blue-600 text-white'
                      : msg.isError
                        ? 'border border-red-500/40 bg-red-950/30 text-red-100'
                        : msg.isCompactSummary
                          ? 'border border-blue-500/40 bg-[#111827] text-slate-100'
                          : 'border border-slate-800 bg-[#111827] text-slate-100'
                  }`}
                >
                  {msg.isError && (
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-red-300">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Erreur API</span>
                      </div>
                      {previousUserMessage && (
                        <button
                          type="button"
                          disabled={sending || Boolean(pendingPermission)}
                          onClick={() => void onSendMessage(previousUserMessage.content)}
                          className="inline-flex items-center gap-1 rounded-md border border-red-400/40 bg-red-950/60 px-2 py-1 text-[11px] font-medium text-red-100 transition-colors hover:bg-red-900/60 disabled:opacity-40"
                        >
                          <RotateCcw className="h-3 w-3" aria-hidden="true" />
                          <span>Réessayer</span>
                        </button>
                      )}
                    </div>
                  )}

                  {isUser ? (
                    <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{msg.content}</p>
                  ) : (
                    <MarkdownText content={msg.content} />
                  )}

                  {msg.subagents && msg.subagents.length > 0 && (
                    <div className="mt-3 border-t border-slate-800/90 pt-2.5 space-y-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-medium text-blue-300">
                        <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Sous-agents délégués ({msg.subagents.length})</span>
                      </div>
                      {msg.subagents.map((sub) => (
                        <div
                          key={sub.id}
                          className="rounded-lg border border-slate-800 bg-[#0B0F17] p-2.5 space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                            <span className="font-medium text-slate-200">{sub.role}</span>
                            <span className="font-mono tabular-nums">
                              {sub.model} · {sub.durationMs}ms
                            </span>
                          </div>
                          <p className="text-[12px] leading-relaxed text-slate-300">{sub.summary}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="mt-3 border-t border-slate-800/90 pt-2.5">
                      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                        <Wrench className="h-3 w-3" aria-hidden="true" />
                        <span>Actions d’outils ({msg.toolCalls.length})</span>
                      </div>
                      <ul className="space-y-1">
                        {msg.toolCalls.map((tool) => {
                          const statusMeta = TOOL_STATUS_LABEL[tool.status];
                          const target =
                            tool.args.path ??
                            tool.args.command ??
                            tool.args.tool_name ??
                            tool.args.role ??
                            tool.args.filter ??
                            '';
                          return (
                            <li
                              key={tool.id}
                              className="flex items-center justify-between gap-3 rounded-md bg-[#0B0F17] px-2.5 py-1.5 font-mono text-[11px]"
                            >
                              <span className="truncate text-slate-300">
                                {tool.name}({String(target)})
                              </span>
                              <span className={`shrink-0 font-sans font-medium ${statusMeta.tone}`}>
                                {statusMeta.text}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              </article>
            );
          })}

          {!sending &&
            !pendingPermission &&
            messages.length > 0 &&
            messages[messages.length - 1].role === 'user' && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-950/15 px-4 py-2.5 text-xs text-amber-200">
                <span>Cette demande n’a pas encore reçu de réponse (interrompue ou en attente).</span>
                <button
                  type="button"
                  onClick={() => void onSendMessage(messages[messages.length - 1].content)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-amber-400/40 bg-amber-950/50 px-2.5 py-1 text-[11px] font-semibold text-amber-100 transition-colors hover:bg-amber-900/60 whitespace-nowrap"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  <span>Relancer</span>
                </button>
              </div>
            )}

          {sending && (
            <div className="flex flex-col items-start">
              <div className="mb-1.5 flex items-center gap-2 text-[11px] text-slate-400">
                <span className="font-medium text-slate-300">Kiln</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{activeModel}</span>
              </div>
              <div className="rounded-xl border border-slate-800 bg-[#111827] px-4 py-3 text-[13px] text-slate-300">
                Analyse et exécution en cours...
              </div>
            </div>
          )}

          <div ref={scrollEndRef} />
        </div>
      </div>

      {/* Interactive Permission Gate */}
      {pendingPermission && (
        <div
          role="region"
          aria-label="Demande de permission requise"
          className="border-t border-amber-500/40 bg-amber-950/20 px-4 py-3.5 sm:px-8"
        >
          <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Permission requise · {pendingPermission.toolName}</span>
              </div>
              <p className="text-[13px] text-slate-100">{pendingPermission.description}</p>
              {pendingPermission.details && (
                <pre className="max-h-24 overflow-y-auto rounded-md border border-slate-800 bg-[#0B0F17] p-2 font-mono text-[11px] text-slate-300">
                  {pendingPermission.details}
                </pre>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={resolvingPermission}
                onClick={() => onResolvePermission(pendingPermission.id, 'deny')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#111827] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-red-500/60 hover:text-red-200 disabled:opacity-50 whitespace-nowrap"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Refuser</span>
              </button>
              <button
                type="button"
                disabled={resolvingPermission}
                onClick={() => onResolvePermission(pendingPermission.id, 'approve')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 whitespace-nowrap"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Autoriser</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Composer */}
      <div className="relative border-t border-slate-800/90 bg-[#111827] px-4 py-3.5 sm:px-8">
        {matchingCommands.length > 0 && (
          <div
            role="listbox"
            aria-label="Commandes rapides"
            className="mx-auto mb-2 max-w-3xl overflow-hidden rounded-xl border border-slate-700/80 bg-[#0B0F17] p-1"
          >
            {matchingCommands.map((item) => (
              <button
                key={item.cmd}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => void submitText(item.cmd)}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-slate-800"
              >
                <span className="font-mono font-semibold text-blue-300">{item.cmd}</span>
                <span className="truncate text-slate-400">{item.desc}</span>
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mx-auto max-w-3xl space-y-2">
          <div className="flex items-end gap-2.5">
            <div className="relative flex-1">
              <textarea
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                onKeyDown={handleKeyDown}
                rows={2}
                disabled={sending || Boolean(pendingPermission)}
                aria-label="Message à Kiln"
                placeholder={
                  pendingPermission
                    ? 'Validez ou refusez la permission ci-dessus...'
                    : 'Décrivez une tâche ou tapez /compact...'
                }
                className="min-h-[54px] w-full resize-none rounded-xl border border-slate-700/80 bg-[#0B0F17] px-3.5 py-2 text-[14px] leading-snug text-slate-100 placeholder-slate-500 outline-none transition-colors focus:border-blue-500 disabled:opacity-60"
              />
            </div>

            <div className="flex items-center gap-2 shrink-0 pb-1">
              <button
                type="button"
                disabled={sending || Boolean(pendingPermission) || messages.length <= 2}
                onClick={() => void submitText('/compact')}
                title="Condenser l'historique (/compact)"
                aria-label="Condenser la conversation avec /compact"
                className="hidden items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-600 hover:text-white disabled:opacity-40 sm:inline-flex whitespace-nowrap"
              >
                <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>/compact</span>
              </button>

              <button
                type="submit"
                disabled={sending || Boolean(pendingPermission)}
                aria-label="Envoyer le message"
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50 whitespace-nowrap"
              >
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
                <span>Envoyer</span>
              </button>
            </div>
          </div>

          {validationError && (
            <p role="alert" className="text-xs text-red-400">
              {validationError}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
