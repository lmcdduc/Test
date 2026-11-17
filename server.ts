import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import {
  AVAILABLE_MODELS,
  buildSystemPrompt,
  createInitialSession,
  DEFAULT_MODEL_ID,
  executeSafeCommand,
  runSelfCheckSuite,
  WorkspaceSandbox,
} from './src/server/kilnEngine';
import {
  DEFAULT_HOOKS,
  DEFAULT_MCP_SERVERS,
  evaluateHooks,
  executeMcpTool,
  parseSpecTasks,
} from './src/server/kilnExtensions';
import {
  formatGeminiError,
  makeTerminalEntry,
  resumePausedAgent,
  runAgentStep,
  runCompactOnSession,
  type AgentRuntimeContext,
  type PausedAgentState,
} from './src/server/geminiAgent';
import type {
  ChatMessage,
  ChatSession,
  HookRule,
  McpServerConfig,
  PendingPermission,
  SpecTaskItem,
  TerminalEntry,
  ThinkingLevelOption,
} from './src/shared/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_DIR = path.resolve(__dirname, 'kiln-workspace');
const DATA_DIR = path.resolve(__dirname, '.kiln-data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const EXTENSIONS_FILE = path.join(DATA_DIR, 'extensions.json');
const PENDING_FILE = path.join(DATA_DIR, 'pending.json');

const workspace = new WorkspaceSandbox(WORKSPACE_DIR, true);

function readAgentsRules(): string {
  try {
    return workspace.readFile('agents.md');
  } catch {
    return '';
  }
}

function getSpecTasks(): SpecTaskItem[] {
  try {
    return parseSpecTasks(workspace.readFile('spec.md'));
  } catch {
    return [];
  }
}

function loadExtensions(): { hooks: HookRule[]; mcpServers: McpServerConfig[] } {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(EXTENSIONS_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(EXTENSIONS_FILE, 'utf-8')) as {
        hooks?: HookRule[];
        mcpServers?: McpServerConfig[];
      };
      if (Array.isArray(parsed.hooks) && Array.isArray(parsed.mcpServers)) {
        const existingHookIds = new Set(parsed.hooks.map((h) => h.id));
        const existingMcpIds = new Set(parsed.mcpServers.map((m) => m.id));
        const mergedHooks = [
          ...parsed.hooks,
          ...DEFAULT_HOOKS.filter((h) => !existingHookIds.has(h.id)),
        ];
        const mergedMcp = [
          ...parsed.mcpServers,
          ...DEFAULT_MCP_SERVERS.filter((m) => !existingMcpIds.has(m.id)),
        ];
        if (mergedHooks.length !== parsed.hooks.length || mergedMcp.length !== parsed.mcpServers.length) {
          saveExtensions(mergedHooks, mergedMcp);
        }
        return { hooks: mergedHooks, mcpServers: mergedMcp };
      }
    } catch {
      // Fallback to defaults
    }
  }
  const initial = { hooks: DEFAULT_HOOKS, mcpServers: DEFAULT_MCP_SERVERS };
  saveExtensions(initial.hooks, initial.mcpServers);
  return initial;
}

function saveExtensions(hooks: HookRule[], mcpServers: McpServerConfig[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(EXTENSIONS_FILE, JSON.stringify({ hooks, mcpServers }, null, 2), 'utf-8');
}

const extState = loadExtensions();
let hooksState: HookRule[] = extState.hooks;
let mcpState: McpServerConfig[] = extState.mcpServers;

function getEnabledMcpTools(): string[] {
  return mcpState.filter((s) => s.enabled).flatMap((s) => s.tools);
}

function loadSessions(): ChatSession[] {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(SESSIONS_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8')) as ChatSession[];
      if (Array.isArray(raw) && raw.length > 0) {
        return raw.map((s) => ({
          ...s,
          thinkingLevel: s.thinkingLevel ?? 'HIGH',
        }));
      }
    } catch {
      // Fallback
    }
  }
  const initial = [
    createInitialSession(
      'session-main',
      'Session principale',
      DEFAULT_MODEL_ID,
      readAgentsRules(),
      'HIGH',
      getEnabledMcpTools(),
    ),
  ];
  saveSessions(initial);
  return initial;
}

function saveSessions(sessions: ChatSession[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf-8');
}

function getRuntimeContext(): AgentRuntimeContext {
  return {
    workspace,
    hooks: hooksState,
    mcpServers: mcpState,
  };
}

type StoredPendingEntry = {
  permission: PendingPermission;
  kind: 'agent' | 'terminal';
  pausedAgent?: PausedAgentState;
  command?: string;
};

function loadPendingPermissions(): Map<string, StoredPendingEntry> {
  const map = new Map<string, StoredPendingEntry>();
  if (fs.existsSync(PENDING_FILE)) {
    try {
      const entries = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf-8')) as Array<[string, StoredPendingEntry]>;
      if (Array.isArray(entries)) {
        for (const [k, v] of entries) {
          if (k && v?.permission) map.set(k, v);
        }
      }
    } catch {
      // Ignore corrupt pending cache
    }
  }
  return map;
}

function savePendingPermissions(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    PENDING_FILE,
    JSON.stringify(Array.from(pendingPermissions.entries()), null, 2),
    'utf-8',
  );
}

let sessions: ChatSession[] = loadSessions();
const pendingPermissions = loadPendingPermissions();
const terminalLogs: TerminalEntry[] = [
  makeTerminalEntry(
    'info',
    'Terminal Kiln actif. Workspace sandbox monté sur /workspace. Tapez "help" ou lancez le Self-Check.',
  ),
];

function appendTerminalLogs(entries: TerminalEntry[]): void {
  terminalLogs.push(...entries);
  if (terminalLogs.length > 250) {
    terminalLogs.splice(0, terminalLogs.length - 250);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
      workspaceFiles: workspace.listFiles().length,
    });
  });

  app.get('/api/bootstrap', (_req, res) => {
    const activePending = Array.from(pendingPermissions.values()).map((p) => p.permission);
    res.json({
      models: AVAILABLE_MODELS,
      sessions,
      files: workspace.listFiles(),
      terminalLogs,
      pendingPermissions: activePending,
      hooks: hooksState,
      mcpServers: mcpState,
      specTasks: getSpecTasks(),
    });
  });

  app.post('/api/sessions', (req, res) => {
    const title =
      typeof req.body?.title === 'string' && req.body.title.trim()
        ? req.body.title.trim()
        : `Session ${sessions.length + 1}`;
    const model =
      typeof req.body?.model === 'string' && AVAILABLE_MODELS.some((m) => m.id === req.body.model)
        ? req.body.model
        : DEFAULT_MODEL_ID;
    const newSession = createInitialSession(
      `session-${Date.now()}`,
      title,
      model,
      readAgentsRules(),
      'HIGH',
      getEnabledMcpTools(),
    );
    sessions = [newSession, ...sessions];
    saveSessions(sessions);
    appendTerminalLogs([
      makeTerminalEntry('info', `Nouvelle session créée : "${newSession.title}" (${model})`),
    ]);
    res.status(201).json({ session: newSession, sessions });
  });

  app.delete('/api/sessions/:id', (req, res) => {
    const { id } = req.params;
    if (sessions.length <= 1) {
      return res.status(400).json({ error: 'Impossible de supprimer la dernière session active.' });
    }
    sessions = sessions.filter((s) => s.id !== id);
    for (const [permId, entry] of pendingPermissions.entries()) {
      if (entry.permission.sessionId === id) {
        pendingPermissions.delete(permId);
      }
    }
    savePendingPermissions();
    saveSessions(sessions);
    res.json({ sessions });
  });

  app.post('/api/sessions/:id/model', (req, res) => {
    const { id } = req.params;
    const modelId = String(req.body?.model ?? '');
    const thinkingLevel = req.body?.thinkingLevel as ThinkingLevelOption | undefined;
    const foundModel = AVAILABLE_MODELS.find((m) => m.id === modelId);
    if (!foundModel) {
      return res.status(400).json({ error: `Modèle inconnu : ${modelId}` });
    }
    const session = sessions.find((s) => s.id === id);
    if (!session) {
      return res.status(404).json({ error: 'Session introuvable.' });
    }
    session.model = foundModel.id;
    if (thinkingLevel && ['LOW', 'MEDIUM', 'HIGH', 'XHIGH'].includes(thinkingLevel)) {
      session.thinkingLevel = thinkingLevel;
    }
    session.systemPromptPreview = buildSystemPrompt({
      model: foundModel.id,
      thinkingLevel: session.thinkingLevel,
      agentsRules: readAgentsRules(),
      enabledMcpTools: getEnabledMcpTools(),
    });
    session.updatedAt = new Date().toISOString();
    saveSessions(sessions);
    appendTerminalLogs([
      makeTerminalEntry(
        'info',
        `[MOTEUR] Modèle : ${foundModel.id} · Raisonnement : ${session.thinkingLevel}`,
      ),
    ]);
    res.json({ session });
  });

  app.post('/api/sessions/:id/auto-approve', (req, res) => {
    const { id } = req.params;
    const session = sessions.find((s) => s.id === id);
    if (!session) {
      return res.status(404).json({ error: 'Session introuvable.' });
    }
    session.autoApprove = Boolean(req.body?.autoApprove);
    session.updatedAt = new Date().toISOString();
    saveSessions(sessions);
    appendTerminalLogs([
      makeTerminalEntry(
        'info',
        `[PERMISSIONS] Mode Auto-Approuver ${session.autoApprove ? 'activé' : 'désactivé'} pour "${session.title}".`,
      ),
    ]);
    res.json({ session });
  });

  app.post('/api/hooks/:id/toggle', (req, res) => {
    const { id } = req.params;
    hooksState = hooksState.map((h) => (h.id === id ? { ...h, enabled: !h.enabled } : h));
    saveExtensions(hooksState, mcpState);
    const updated = hooksState.find((h) => h.id === id);
    if (updated) {
      appendTerminalLogs([
        makeTerminalEntry(
          'hook',
          `[HOOK] "${updated.name}" ${updated.enabled ? 'activé' : 'désactivé'}.`,
        ),
      ]);
    }
    res.json({ hooks: hooksState, terminalLogs });
  });

  app.post('/api/mcp/:id/toggle', (req, res) => {
    const { id } = req.params;
    mcpState = mcpState.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m));
    saveExtensions(hooksState, mcpState);
    const updated = mcpState.find((m) => m.id === id);
    if (updated) {
      appendTerminalLogs([
        makeTerminalEntry(
          'info',
          `[MCP] Serveur "${updated.name}" ${updated.enabled ? 'connecté' : 'déconnecté'}.`,
        ),
      ]);
    }
    for (const s of sessions) {
      s.systemPromptPreview = buildSystemPrompt({
        model: s.model,
        thinkingLevel: s.thinkingLevel,
        agentsRules: readAgentsRules(),
        enabledMcpTools: getEnabledMcpTools(),
      });
    }
    saveSessions(sessions);
    res.json({ mcpServers: mcpState, sessions, terminalLogs });
  });

  app.post('/api/mcp/test', (req, res) => {
    const toolName = String(req.body?.toolName ?? '');
    const result = executeMcpTool(mcpState, toolName, workspace);
    appendTerminalLogs([
      makeTerminalEntry('action', `[MCP TEST] ${toolName}`),
      makeTerminalEntry(result.ok ? 'stdout' : 'stderr', result.output),
    ]);
    res.json({ ...result, terminalLogs });
  });

  app.post('/api/chat', async (req, res) => {
    const sessionId = String(req.body?.sessionId ?? '');
    const userText = String(req.body?.message ?? '').trim();
    const session = sessions.find((s) => s.id === sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session introuvable.' });
    }
    if (!userText) {
      return res.status(400).json({ error: 'Le message ne peut pas être vide.' });
    }

    if (userText === '/compact') {
      const compactRes = await runCompactOnSession(session);
      session.messages = compactRes.messages;
      session.updatedAt = new Date().toISOString();
      saveSessions(sessions);
      appendTerminalLogs([
        makeTerminalEntry(
          'success',
          `[/compact] Historique condensé (${compactRes.usedFallback ? 'synthèse locale' : 'Gemini'}).`,
        ),
      ]);
      return res.json({
        session,
        pendingPermission: null,
        terminalLogs,
        files: workspace.listFiles(),
        specTasks: getSpecTasks(),
      });
    }

    const trailing = session.messages.at(-1);
    if (!(trailing && trailing.role === 'user' && trailing.content === userText)) {
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: userText,
        timestamp: new Date().toISOString(),
      };
      session.messages.push(userMsg);
    }
    if (session.title === 'Session principale' && session.messages.length <= 3) {
      session.title = userText.slice(0, 36) + (userText.length > 36 ? '…' : '');
    }
    session.updatedAt = new Date().toISOString();
    saveSessions(sessions);

    try {
      const outcome = await runAgentStep(session, getRuntimeContext());
      appendTerminalLogs(outcome.terminalEntries);
      if (outcome.messages.length > 0) {
        session.messages.push(...outcome.messages);
      }
      if (outcome.pendingPermission && outcome.pausedState) {
        pendingPermissions.set(outcome.pendingPermission.id, {
          permission: outcome.pendingPermission,
          kind: 'agent',
          pausedAgent: outcome.pausedState,
        });
      }
      savePendingPermissions();
      session.updatedAt = new Date().toISOString();
      saveSessions(sessions);

      return res.json({
        session,
        pendingPermission: outcome.pendingPermission,
        terminalLogs,
        files: workspace.listFiles(),
        specTasks: getSpecTasks(),
      });
    } catch (err) {
      const errText = formatGeminiError(err);
      appendTerminalLogs([makeTerminalEntry('stderr', `[GEMINI ERROR] ${errText}`)]);
      session.messages.push({
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: errText,
        timestamp: new Date().toISOString(),
        model: session.model,
        isError: true,
      });
      session.updatedAt = new Date().toISOString();
      saveSessions(sessions);
      return res.status(200).json({
        session,
        pendingPermission: null,
        terminalLogs,
        files: workspace.listFiles(),
        specTasks: getSpecTasks(),
      });
    }
  });

  app.post('/api/permissions/:id', async (req, res) => {
    const { id } = req.params;
    const decision = req.body?.decision === 'approve' ? 'approve' : 'deny';
    const record = pendingPermissions.get(id);
    if (!record) {
      return res.status(404).json({ error: 'Demande de permission introuvable ou déjà traitée.' });
    }
    pendingPermissions.delete(id);
    savePendingPermissions();

    const session = sessions.find((s) => s.id === record.permission.sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session associée introuvable.' });
    }

    if (record.kind === 'terminal' && record.command) {
      if (decision === 'approve') {
        const preHook = evaluateHooks(hooksState, 'pre_command', { command: record.command }, workspace);
        appendTerminalLogs(preHook.logs.map((l) => makeTerminalEntry('hook', l)));
        appendTerminalLogs([makeTerminalEntry('command', `$ ${record.command}`)]);
        const result = executeSafeCommand(record.command, workspace);
        if (result.stdout) appendTerminalLogs([makeTerminalEntry('stdout', result.stdout)]);
        if (result.stderr) appendTerminalLogs([makeTerminalEntry('stderr', result.stderr)]);
      } else {
        appendTerminalLogs([
          makeTerminalEntry('stderr', `[PERMISSION REFUSÉE] Exécution annulée : ${record.command}`),
        ]);
      }
      return res.json({
        session,
        pendingPermission: null,
        terminalLogs,
        files: workspace.listFiles(),
        specTasks: getSpecTasks(),
      });
    }

    if (record.kind === 'agent' && record.pausedAgent) {
      try {
        const outcome = await resumePausedAgent(
          session,
          record.pausedAgent,
          decision,
          getRuntimeContext(),
        );
        appendTerminalLogs(outcome.terminalEntries);
        if (outcome.messages.length > 0) {
          session.messages.push(...outcome.messages);
        }
        if (outcome.pendingPermission && outcome.pausedState) {
          pendingPermissions.set(outcome.pendingPermission.id, {
            permission: outcome.pendingPermission,
            kind: 'agent',
            pausedAgent: outcome.pausedState,
          });
        }
        savePendingPermissions();
        session.updatedAt = new Date().toISOString();
        saveSessions(sessions);
        return res.json({
          session,
          pendingPermission: outcome.pendingPermission,
          terminalLogs,
          files: workspace.listFiles(),
          specTasks: getSpecTasks(),
        });
      } catch (err) {
        const errText = formatGeminiError(err);
        appendTerminalLogs([makeTerminalEntry('stderr', `[GEMINI ERROR] ${errText}`)]);
        session.messages.push({
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: errText,
          timestamp: new Date().toISOString(),
          model: session.model,
          isError: true,
        });
        saveSessions(sessions);
        return res.json({
          session,
          pendingPermission: null,
          terminalLogs,
          files: workspace.listFiles(),
          specTasks: getSpecTasks(),
        });
      }
    }

    res.json({
      session,
      pendingPermission: null,
      terminalLogs,
      files: workspace.listFiles(),
      specTasks: getSpecTasks(),
    });
  });

  app.get('/api/files', (_req, res) => {
    res.json({ files: workspace.listFiles(), specTasks: getSpecTasks() });
  });

  app.get('/api/files/content', (req, res) => {
    const filePath = String(req.query.path ?? '');
    try {
      const content = workspace.readFile(filePath);
      res.json({ path: filePath, content });
    } catch (err) {
      res.status(404).json({ error: String((err as Error).message ?? err) });
    }
  });

  app.post('/api/files/content', async (req, res) => {
    const filePath = String(req.body?.path ?? '');
    const content = String(req.body?.content ?? '');
    try {
      const preHook = evaluateHooks(hooksState, 'pre_write', { targetPath: filePath, content }, workspace);
      appendTerminalLogs(preHook.logs.map((l) => makeTerminalEntry('hook', l)));
      if (!preHook.allowed) {
        return res.status(400).json({ error: preHook.blockedReason ?? 'Bloqué par hook pre_write', terminalLogs });
      }

      const saved = workspace.writeFile(filePath, content);
      appendTerminalLogs([
        makeTerminalEntry('success', `[FICHIER] "${saved.path}" enregistré (${saved.bytes} octets)`),
      ]);
      const postHook = evaluateHooks(hooksState, 'post_write', { targetPath: saved.path }, workspace);
      appendTerminalLogs(postHook.logs.map((l) => makeTerminalEntry('hook', l)));

      if (saved.path === 'agents.md') {
        for (const s of sessions) {
          s.systemPromptPreview = buildSystemPrompt({
            model: s.model,
            thinkingLevel: s.thinkingLevel,
            agentsRules: content,
            enabledMcpTools: getEnabledMcpTools(),
          });
        }
        saveSessions(sessions);
      }

      res.json({
        saved,
        files: workspace.listFiles(),
        terminalLogs,
        sessions,
        specTasks: getSpecTasks(),
      });
    } catch (err) {
      res.status(400).json({ error: String((err as Error).message ?? err) });
    }
  });

  app.post('/api/terminal/exec', async (req, res) => {
    const command = String(req.body?.command ?? '').trim();
    const sessionId = String(req.body?.sessionId ?? sessions[0]?.id ?? 'session-main');
    const session = sessions.find((s) => s.id === sessionId) ?? sessions[0];

    if (!command) {
      return res.status(400).json({ error: 'Commande vide.' });
    }

    if (command.toLowerCase() === 'self-check') {
      appendTerminalLogs([makeTerminalEntry('command', '$ self-check')]);
      const report = await runSelfCheckSuite();
      for (const c of report.cases) {
        appendTerminalLogs([
          makeTerminalEntry(
            c.passed ? 'success' : 'stderr',
            `[${c.passed ? 'PASS' : 'FAIL'}] ${c.name} (${c.durationMs}ms)${c.passed ? '' : ` — ${c.detail}`}`,
          ),
        ]);
      }
      appendTerminalLogs([
        makeTerminalEntry(
          report.allPassed ? 'success' : 'stderr',
          `[SELF-CHECK] ${report.passedCount}/${report.totalCount} tests validés.`,
        ),
      ]);
      return res.json({ report, terminalLogs, pendingPermission: null });
    }

    const isCodeExec = command.toLowerCase().startsWith('node ');
    if (isCodeExec && session && !session.autoApprove) {
      const permId = `perm-term-${Date.now()}`;
      const perm: PendingPermission = {
        id: permId,
        sessionId: session.id,
        toolName: 'run_command',
        description: `Exécuter la commande sandbox : "${command}"`,
        details: command,
        args: { command },
        createdAt: new Date().toISOString(),
      };
      pendingPermissions.set(permId, {
        permission: perm,
        kind: 'terminal',
        command,
      });
      savePendingPermissions();
      appendTerminalLogs([
        makeTerminalEntry('permission', `[PERMISSION REQUISE] Exécuter "${command}"`),
      ]);
      return res.json({ pendingPermission: perm, terminalLogs });
    }

    const preHook = evaluateHooks(hooksState, 'pre_command', { command }, workspace);
    appendTerminalLogs(preHook.logs.map((l) => makeTerminalEntry('hook', l)));
    appendTerminalLogs([makeTerminalEntry('command', `$ ${command}`)]);
    const result = executeSafeCommand(command, workspace);
    if (result.stdout) appendTerminalLogs([makeTerminalEntry('stdout', result.stdout)]);
    if (result.stderr) appendTerminalLogs([makeTerminalEntry('stderr', result.stderr)]);
    return res.json({ result, terminalLogs, pendingPermission: null });
  });

  app.post('/api/self-check', async (_req, res) => {
    appendTerminalLogs([makeTerminalEntry('command', '$ self-check --suite')]);
    const report = await runSelfCheckSuite();
    for (const c of report.cases) {
      appendTerminalLogs([
        makeTerminalEntry(
          c.passed ? 'success' : 'stderr',
          `[${c.passed ? 'PASS' : 'FAIL'}] ${c.name} (${c.durationMs}ms)`,
        ),
      ]);
    }
    appendTerminalLogs([
      makeTerminalEntry(
        report.allPassed ? 'success' : 'stderr',
        `[SELF-CHECK] ${report.passedCount}/${report.totalCount} vérifications réussies (PASS).`,
      ),
    ]);
    res.json({ report, terminalLogs });
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: { server: httpServer },
        hmr: !hmrDisabled,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT || 3000);
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Kiln Agentic Studio running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Kiln server:', err);
  process.exit(1);
});
