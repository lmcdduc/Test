import { useCallback, useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { ChatPane } from './components/ChatPane';
import { FileInspector } from './components/FileInspector';
import { ExtensionsInspector } from './components/ExtensionsInspector';
import { TerminalDrawer } from './components/TerminalDrawer';
import type {
  ChatSession,
  HookRule,
  McpServerConfig,
  ModelOption,
  PendingPermission,
  SelfCheckReport,
  SpecTaskItem,
  TerminalEntry,
  ThinkingLevelOption,
  WorkspaceFileEntry,
} from './shared/types';

interface BootstrapResponse {
  models: ModelOption[];
  sessions: ChatSession[];
  files: WorkspaceFileEntry[];
  terminalLogs: TerminalEntry[];
  pendingPermissions: PendingPermission[];
  hooks: HookRule[];
  mcpServers: McpServerConfig[];
  specTasks: SpecTaskItem[];
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [files, setFiles] = useState<WorkspaceFileEntry[]>([]);
  const [terminalLogs, setTerminalLogs] = useState<TerminalEntry[]>([]);
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);
  const [hooks, setHooks] = useState<HookRule[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [specTasks, setSpecTasks] = useState<SpecTaskItem[]>([]);

  const [sending, setSending] = useState(false);
  const [resolvingPermission, setResolvingPermission] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [inspectorMode, setInspectorMode] = useState<
    'file' | 'system-prompt' | 'spec' | 'mcp-hooks' | null
  >(null);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [activeFileContent, setActiveFileContent] = useState('');
  const [savingFile, setSavingFile] = useState(false);

  const [lastReport, setLastReport] = useState<SelfCheckReport | null>(null);
  const [runningSelfCheck, setRunningSelfCheck] = useState(false);

  const loadBootstrap = useCallback(async () => {
    try {
      const res = await fetch('/api/bootstrap');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as BootstrapResponse;
      setModels(data.models);
      setSessions(data.sessions);
      setActiveSessionId((prev) =>
        data.sessions.some((s) => s.id === prev) ? prev : data.sessions[0]?.id ?? '',
      );
      setFiles(data.files);
      setTerminalLogs(data.terminalLogs);
      setPendingPermission(data.pendingPermissions[0] ?? null);
      setHooks(data.hooks ?? []);
      setMcpServers(data.mcpServers ?? []);
      setSpecTasks(data.specTasks ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(String((err as Error)?.message ?? err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    if (pendingPermission && typeof window !== 'undefined' && window.innerWidth < 1024) {
      setInspectorMode(null);
    }
  }, [pendingPermission]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? sessions[0] ?? null;

  const replaceSession = (updated: ChatSession) => {
    setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const handleNewSession = async () => {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: activeSession?.model }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { session: ChatSession; sessions: ChatSession[] };
    setSessions(data.sessions);
    setActiveSessionId(data.session.id);
    setPendingPermission(null);
  };

  const handleDeleteSession = async (sessionId: string) => {
    const res = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    if (!res.ok) return;
    const data = (await res.json()) as { sessions: ChatSession[] };
    setSessions(data.sessions);
    if (activeSessionId === sessionId) {
      setActiveSessionId(data.sessions[0]?.id ?? '');
    }
  };

  const handleSelectModel = async (modelId: string, thinkingLevel?: ThinkingLevelOption) => {
    if (!activeSession) return;
    const nextThinking = thinkingLevel ?? activeSession.thinkingLevel;
    replaceSession({ ...activeSession, model: modelId, thinkingLevel: nextThinking });
    const res = await fetch(`/api/sessions/${activeSession.id}/model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelId, thinkingLevel: nextThinking }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { session: ChatSession };
    replaceSession(data.session);
  };

  const handleToggleAutoApprove = async () => {
    if (!activeSession) return;
    replaceSession({ ...activeSession, autoApprove: !activeSession.autoApprove });
    const res = await fetch(`/api/sessions/${activeSession.id}/auto-approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoApprove: !activeSession.autoApprove }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { session: ChatSession };
    replaceSession(data.session);
  };

  const handleRunSelfCheck = async () => {
    setRunningSelfCheck(true);
    setTerminalOpen(true);
    try {
      const res = await fetch('/api/self-check', { method: 'POST' });
      if (!res.ok) return;
      const data = (await res.json()) as {
        report: SelfCheckReport;
        terminalLogs: TerminalEntry[];
      };
      setLastReport(data.report);
      setTerminalLogs(data.terminalLogs);
    } finally {
      setRunningSelfCheck(false);
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!activeSession) return;

    if (text === '/self-check') {
      await handleRunSelfCheck();
      return;
    }

    const expandedPrompt =
      text === '/spec'
        ? "Lis agents.md et spec.md via tes outils (et mcp_spec_status), construis la prochaine tâche non terminée du plan une fonctionnalité à la fois, et indique comment la tester."
        : text === '/audit'
          ? "Utilise delegate_subagent pour lancer un audit de qualité et sécurité des fichiers du workspace (hello.js, spec.md, agents.md) puis synthétise les recommandations."
          : text;

    const optimisticId = `optimistic-${Date.now()}`;
    if (expandedPrompt !== '/compact') {
      const optimisticSession: ChatSession = {
        ...activeSession,
        messages: [
          ...activeSession.messages,
          {
            id: optimisticId,
            role: 'user',
            content: expandedPrompt,
            timestamp: new Date().toISOString(),
          },
        ],
      };
      replaceSession(optimisticSession);
    }

    setSending(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSession.id, message: expandedPrompt }),
      });
      const data = (await res.json()) as {
        session: ChatSession;
        pendingPermission: PendingPermission | null;
        terminalLogs: TerminalEntry[];
        files: WorkspaceFileEntry[];
        specTasks?: SpecTaskItem[];
      };
      if (data.session) replaceSession(data.session);
      if (data.terminalLogs) setTerminalLogs(data.terminalLogs);
      if (data.files) setFiles(data.files);
      if (data.specTasks) setSpecTasks(data.specTasks);
      setPendingPermission(data.pendingPermission ?? null);
    } finally {
      setSending(false);
    }
  };

  const handleResolvePermission = async (permissionId: string, decision: 'approve' | 'deny') => {
    setResolvingPermission(true);
    try {
      const res = await fetch(`/api/permissions/${permissionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        session: ChatSession;
        pendingPermission: PendingPermission | null;
        terminalLogs: TerminalEntry[];
        files: WorkspaceFileEntry[];
        specTasks?: SpecTaskItem[];
      };
      if (data.session) replaceSession(data.session);
      if (data.terminalLogs) setTerminalLogs(data.terminalLogs);
      if (data.files) setFiles(data.files);
      if (data.specTasks) setSpecTasks(data.specTasks);
      setPendingPermission(data.pendingPermission ?? null);

      if (activeFilePath && inspectorMode === 'file') {
        const fileRes = await fetch(`/api/files/content?path=${encodeURIComponent(activeFilePath)}`);
        if (fileRes.ok) {
          const fileData = (await fileRes.json()) as { content: string };
          setActiveFileContent(fileData.content);
        }
      }
    } finally {
      setResolvingPermission(false);
    }
  };

  const handleOpenFile = async (filePath: string) => {
    const res = await fetch(`/api/files/content?path=${encodeURIComponent(filePath)}`);
    if (!res.ok) return;
    const data = (await res.json()) as { path: string; content: string };
    setActiveFilePath(data.path);
    setActiveFileContent(data.content);
    setInspectorMode('file');
  };

  const handleCreateFile = async (filePath: string) => {
    const res = await fetch('/api/files/content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: filePath,
        content: `# ${filePath}\n`,
      }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      saved: { path: string };
      files: WorkspaceFileEntry[];
      terminalLogs: TerminalEntry[];
      specTasks?: SpecTaskItem[];
    };
    setFiles(data.files);
    setTerminalLogs(data.terminalLogs);
    if (data.specTasks) setSpecTasks(data.specTasks);
    await handleOpenFile(data.saved.path);
  };

  const handleSaveFile = async (filePath: string, nextContent: string) => {
    setSavingFile(true);
    try {
      const res = await fetch('/api/files/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content: nextContent }),
      });
      const data = (await res.json()) as {
        error?: string;
        files?: WorkspaceFileEntry[];
        terminalLogs?: TerminalEntry[];
        sessions?: ChatSession[];
        specTasks?: SpecTaskItem[];
      };
      if (data.terminalLogs) setTerminalLogs(data.terminalLogs);
      if (!res.ok) {
        if (data.error) setTerminalOpen(true);
        return;
      }
      if (data.files) setFiles(data.files);
      if (data.sessions) setSessions(data.sessions);
      if (data.specTasks) setSpecTasks(data.specTasks);
      setActiveFileContent(nextContent);
    } finally {
      setSavingFile(false);
    }
  };

  const handleRunCommand = async (command: string) => {
    if (!activeSession) return;
    setTerminalOpen(true);
    const res = await fetch('/api/terminal/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, sessionId: activeSession.id }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      terminalLogs: TerminalEntry[];
      pendingPermission: PendingPermission | null;
      report?: SelfCheckReport;
    };
    setTerminalLogs(data.terminalLogs);
    if (data.pendingPermission) setPendingPermission(data.pendingPermission);
    if (data.report) setLastReport(data.report);
  };

  const handleToggleHook = async (hookId: string) => {
    const res = await fetch(`/api/hooks/${hookId}/toggle`, { method: 'POST' });
    if (!res.ok) return;
    const data = (await res.json()) as { hooks: HookRule[]; terminalLogs: TerminalEntry[] };
    setHooks(data.hooks);
    setTerminalLogs(data.terminalLogs);
  };

  const handleToggleMcp = async (serverId: string) => {
    const res = await fetch(`/api/mcp/${serverId}/toggle`, { method: 'POST' });
    if (!res.ok) return;
    const data = (await res.json()) as {
      mcpServers: McpServerConfig[];
      sessions: ChatSession[];
      terminalLogs: TerminalEntry[];
    };
    setMcpServers(data.mcpServers);
    if (data.sessions) setSessions(data.sessions);
    setTerminalLogs(data.terminalLogs);
  };

  const handleTestMcpTool = async (toolName: string) => {
    setTerminalOpen(true);
    const res = await fetch('/api/mcp/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolName }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { terminalLogs: TerminalEntry[] };
    setTerminalLogs(data.terminalLogs);
  };

  const handleBuildNextSpecTask = async (nextTask: SpecTaskItem | undefined) => {
    if (!nextTask) return;
    setInspectorMode(null);
    const prompt = `Lis agents.md et spec.md, construis l'étape suivante non terminée ("${nextTask.title}"), écris les fichiers nécessaires et vérifie le résultat.`;
    await handleSendMessage(prompt);
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0B0F17] text-sm text-slate-400">
        Initialisation de Kiln Studio...
      </div>
    );
  }

  if (loadError || !activeSession) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-[#0B0F17] p-6 text-center">
        <p className="text-sm text-red-400">
          Impossible de joindre le serveur Kiln ({loadError ?? 'Session manquante'}).
        </p>
        <button
          type="button"
          onClick={() => void loadBootstrap()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500"
        >
          Réessayer
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0B0F17] text-slate-100">
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSession.id}
        files={files}
        activeFilePath={activeFilePath}
        inspectorMode={inspectorMode}
        specTasks={specTasks}
        hooks={hooks}
        mcpServers={mcpServers}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        onSelectSession={(id) => {
          setActiveSessionId(id);
          setPendingPermission(null);
        }}
        onNewSession={() => void handleNewSession()}
        onDeleteSession={(id) => void handleDeleteSession(id)}
        onOpenFile={(p) => void handleOpenFile(p)}
        onCreateFile={handleCreateFile}
        onOpenSystemPrompt={() => setInspectorMode('system-prompt')}
        onOpenSpecPanel={() => setInspectorMode('spec')}
        onOpenMcpHooksPanel={() => setInspectorMode('mcp-hooks')}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          sessionTitle={activeSession.title}
          models={models}
          activeModelId={activeSession.model}
          thinkingLevel={activeSession.thinkingLevel}
          autoApprove={activeSession.autoApprove}
          terminalOpen={terminalOpen}
          onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
          onSelectModel={(m, lvl) => void handleSelectModel(m, lvl)}
          onToggleAutoApprove={() => void handleToggleAutoApprove()}
          onToggleTerminal={() => setTerminalOpen((o) => !o)}
        />

        <main className="flex min-h-0 flex-1 overflow-hidden">
          <ChatPane
            messages={activeSession.messages}
            activeModel={activeSession.model}
            sending={sending}
            pendingPermission={pendingPermission}
            resolvingPermission={resolvingPermission}
            onSendMessage={handleSendMessage}
            onResolvePermission={handleResolvePermission}
          />

          {(inspectorMode === 'file' || inspectorMode === 'system-prompt') && (
            <FileInspector
              mode={inspectorMode}
              filePath={activeFilePath}
              content={
                inspectorMode === 'system-prompt'
                  ? activeSession.systemPromptPreview
                  : activeFileContent
              }
              saving={savingFile}
              onSaveFile={handleSaveFile}
              onRunJsFile={(p) => handleRunCommand(`node ${p}`)}
              onClose={() => {
                setInspectorMode(null);
                setActiveFilePath(null);
              }}
            />
          )}

          {(inspectorMode === 'spec' || inspectorMode === 'mcp-hooks') && (
            <ExtensionsInspector
              mode={inspectorMode}
              specTasks={specTasks}
              hooks={hooks}
              mcpServers={mcpServers}
              sending={sending}
              onBuildNextSpecTask={handleBuildNextSpecTask}
              onToggleHook={handleToggleHook}
              onToggleMcp={handleToggleMcp}
              onTestMcpTool={handleTestMcpTool}
              onOpenSpecFile={() => handleOpenFile('spec.md')}
              onClose={() => setInspectorMode(null)}
            />
          )}
        </main>

        {terminalOpen && (
          <TerminalDrawer
            entries={terminalLogs}
            lastReport={lastReport}
            runningSelfCheck={runningSelfCheck}
            onRunCommand={handleRunCommand}
            onRunSelfCheck={handleRunSelfCheck}
            onClose={() => setTerminalOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
