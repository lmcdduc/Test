import type {
  HookEvent,
  HookRule,
  McpServerConfig,
  SpecTaskItem,
} from '../shared/types';
import type { WorkspaceSandbox } from './kilnEngine';

export const DEFAULT_HOOKS: HookRule[] = [
  {
    id: 'hook-block-secrets',
    name: 'Blocage des secrets en clair',
    event: 'pre_write',
    action: 'block_secrets',
    enabled: true,
    description: 'Empêche l’écriture de clés API ou clés privées (AIza..., sk-..., PRIVATE KEY) dans le workspace.',
  },
  {
    id: 'hook-audit-write',
    name: 'Journal d’audit des écritures',
    event: 'post_write',
    action: 'log_audit',
    enabled: true,
    description: 'Consigne chaque création ou modification de fichier avec horodatage dans hooks.log.',
  },
  {
    id: 'hook-pre-cmd-audit',
    name: 'Transparence avant commande',
    event: 'pre_command',
    action: 'log_audit',
    enabled: true,
    description: 'Enregistre une trace [ACTION] avant toute exécution dans le terminal sandbox.',
  },
  {
    id: 'hook-post-write-selfcheck',
    name: 'Validation post-écriture (.js / .ts)',
    event: 'post_write',
    action: 'run_self_check',
    enabled: false,
    description: 'Déclenche une vérification automatique après chaque modification de fichier script.',
  },
];

export const DEFAULT_MCP_SERVERS: McpServerConfig[] = [
  {
    id: 'mcp-spec-tracker',
    name: 'Spec Tracker (REA / spec.md)',
    transport: 'sandbox',
    description: 'Analyse la progression des phases dans spec.md et identifie la prochaine tâche non terminée.',
    enabled: true,
    tools: ['mcp_spec_status'],
  },
  {
    id: 'mcp-workspace-metrics',
    name: 'Workspace Inspector',
    transport: 'sandbox',
    description: 'Calcule les métriques du projet (fichiers, lignes, octets, TODOs) pour le suivi de build.',
    enabled: true,
    tools: ['mcp_workspace_stats'],
  },
  {
    id: 'mcp-cloud-run',
    name: 'Google Cloud Run Readiness',
    transport: 'sandbox',
    description: 'Vérifie la compatibilité Cloud Run (PORT, variables d’env, fichiers directeurs) et génère le manifeste.',
    enabled: true,
    tools: ['mcp_cloud_manifest'],
  },
  {
    id: 'mcp-rea-analyzer',
    name: 'REA Blueprint Analyzer',
    transport: 'sandbox',
    description: 'Inspecte les modules du workspace (imports, exports, fonctions, docs) pour préparer un plan de build ou de clonage.',
    enabled: true,
    tools: ['mcp_rea_analyze'],
  },
];

export interface HookExecutionContext {
  targetPath?: string;
  content?: string;
  command?: string;
}

export interface HookEvaluationResult {
  allowed: boolean;
  blockedReason?: string;
  logs: string[];
  shouldTriggerSelfCheck: boolean;
}

const SECRET_PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z_-]{20,}/,
  /sk-[0-9A-Za-z]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /Bearer\s+[A-Za-z0-9._-]{20,}/,
  /process\.env\.[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/,
  /GEMINI_API_KEY\s*[:=]\s*["'][^"']{6,}["']/,
];

function sanitizeAuditValue(value: string): string {
  let cleaned = value;
  for (const re of SECRET_PATTERNS) {
    cleaned = cleaned.replace(new RegExp(re.source, 'g'), '[REDACTED]');
  }
  return cleaned.replace(/[\r\n]+/g, ' ').slice(0, 240);
}

export function evaluateHooks(
  hooks: HookRule[],
  event: HookEvent,
  context: HookExecutionContext,
  workspace?: WorkspaceSandbox,
): HookEvaluationResult {
  const matching = hooks.filter((h) => h.enabled && h.event === event);
  const logs: string[] = [];
  let shouldTriggerSelfCheck = false;

  for (const hook of matching) {
    if (hook.action === 'block_secrets' && event === 'pre_write') {
      const targetName = (context.targetPath ?? '').trim().toLowerCase();
      if (targetName === '.env' || targetName.startsWith('.env.') || targetName.endsWith('/.env')) {
        const reason = `Hook "${hook.name}" : écriture dans un fichier d'environnement (${context.targetPath}) bloquée.`;
        logs.push(`[HOOK BLOCK] ${reason}`);
        return {
          allowed: false,
          blockedReason: reason,
          logs,
          shouldTriggerSelfCheck: false,
        };
      }
      const content = context.content ?? '';
      const found = SECRET_PATTERNS.some((re) => re.test(content));
      if (found) {
        const reason = `Hook "${hook.name}" : secret ou accès sensible (process.env / clé API) détecté dans "${context.targetPath ?? 'fichier'}". Écriture bloquée.`;
        logs.push(`[HOOK BLOCK] ${reason}`);
        return {
          allowed: false,
          blockedReason: reason,
          logs,
          shouldTriggerSelfCheck: false,
        };
      }
      logs.push(`[HOOK OK] ${hook.name} (${context.targetPath ?? ''})`);
    } else if (hook.action === 'log_audit') {
      const rawTarget = context.targetPath ?? context.command ?? '-';
      const target = sanitizeAuditValue(rawTarget);
      const line = `[${new Date().toISOString()}] [${event}] ${target}`;
      logs.push(`[HOOK AUDIT] ${hook.name} -> ${target}`);
      if (workspace && context.targetPath !== 'hooks.log') {
        try {
          let prev = '';
          try {
            prev = workspace.readFile('hooks.log');
          } catch {
            prev = '';
          }
          const next = (prev ? `${prev.trimEnd()}\n` : '') + line + '\n';
          workspace.writeFile('hooks.log', next);
        } catch {
          // Ignore audit log failure to avoid blocking core flow
        }
      }
    } else if (hook.action === 'run_self_check') {
      if (context.targetPath && /\.(js|mjs|ts|tsx)$/i.test(context.targetPath)) {
        shouldTriggerSelfCheck = true;
        logs.push(`[HOOK TRIGGER] ${hook.name} activé pour ${context.targetPath}`);
      }
    }
  }

  return {
    allowed: true,
    logs,
    shouldTriggerSelfCheck,
  };
}

export function parseSpecTasks(specMarkdown: string): SpecTaskItem[] {
  const lines = specMarkdown.split('\n');
  let currentPhase = 'Général';
  const items: SpecTaskItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const phaseMatch = line.match(/^##\s+(.+)/);
    if (phaseMatch) {
      currentPhase = phaseMatch[1].trim();
      continue;
    }
    const taskMatch = line.match(/^\s*-\s*\[(x|X| )\]\s+(.+)/);
    if (taskMatch) {
      const completed = taskMatch[1].toLowerCase() === 'x';
      const title = taskMatch[2].replace(/\*\*/g, '').trim();
      items.push({
        id: `spec-${i + 1}`,
        phase: currentPhase,
        title,
        completed,
        rawLine: line,
      });
    }
  }

  return items;
}

export function executeMcpTool(
  servers: McpServerConfig[],
  toolName: string,
  workspace: WorkspaceSandbox,
): { ok: boolean; output: string } {
  const server = servers.find((s) => s.tools.includes(toolName));
  if (!server) {
    return { ok: false, output: `Outil MCP inconnu : ${toolName}` };
  }
  if (!server.enabled) {
    return {
      ok: false,
      output: `Le serveur MCP "${server.name}" est actuellement désactivé.`,
    };
  }

  if (toolName === 'mcp_spec_status') {
    let specText = '';
    try {
      specText = workspace.readFile('spec.md');
    } catch {
      return { ok: false, output: 'Fichier spec.md introuvable dans le workspace.' };
    }
    const tasks = parseSpecTasks(specText);
    const done = tasks.filter((t) => t.completed).length;
    const nextTask = tasks.find((t) => !t.completed);
    return {
      ok: true,
      output: JSON.stringify(
        {
          server: server.name,
          totalTasks: tasks.length,
          completedTasks: done,
          nextPendingTask: nextTask ? `${nextTask.phase} -> ${nextTask.title}` : 'Toutes les tâches sont terminées.',
          tasks: tasks.map((t) => ({ phase: t.phase, title: t.title, completed: t.completed })),
        },
        null,
        2,
      ),
    };
  }

  if (toolName === 'mcp_workspace_stats') {
    const files = workspace.listFiles();
    let totalLines = 0;
    let totalBytes = 0;
    let todoCount = 0;
    for (const f of files) {
      totalBytes += f.size;
      try {
        const text = workspace.readFile(f.path);
        totalLines += text.split('\n').length;
        const matches = text.match(/TODO|FIXME/gi);
        if (matches) todoCount += matches.length;
      } catch {
        // Ignore binary/unreadable
      }
    }
    return {
      ok: true,
      output: JSON.stringify(
        {
          server: server.name,
          fileCount: files.length,
          totalLines,
          totalBytes,
          todoCount,
          files: files.map((f) => f.path),
        },
        null,
        2,
      ),
    };
  }

  if (toolName === 'mcp_cloud_manifest') {
    const files = workspace.listFiles().map((f) => f.path);
    const hasAgents = files.includes('agents.md');
    const hasSpec = files.includes('spec.md');
    const hasFeatures = files.includes('features.md');
    return {
      ok: true,
      output: JSON.stringify(
        {
          server: server.name,
          target: 'Google Cloud Run + Google AI Studio',
          steeringFilesReady: hasAgents && hasSpec && hasFeatures,
          nodeVersion: process.version,
          recommendedPort: 3000,
          envVarsRequired: ['GEMINI_API_KEY'],
        },
        null,
        2,
      ),
    };
  }

  if (toolName === 'mcp_rea_analyze') {
    const files = workspace.listFiles();
    const modules: Array<{
      path: string;
      kind: 'code' | 'doc' | 'log';
      lines: number;
      exports: string[];
      functions: string[];
      moduleStyle: 'esm' | 'commonjs' | 'markdown' | 'other';
    }> = [];

    for (const file of files) {
      let text = '';
      try {
        text = workspace.readFile(file.path);
      } catch {
        continue;
      }
      const lines = text.split('\n').length;
      const isCode = /\.(js|mjs|cjs|ts|tsx)$/i.test(file.path);
      const isDoc = /\.md$/i.test(file.path);
      const exportsMatches = [...text.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_$]+)/g)].map(
        (m) => m[1],
      );
      const exportBlockMatch = text.match(/export\s*\{([^}]+)\}/);
      if (exportBlockMatch) {
        for (const item of exportBlockMatch[1].split(',')) {
          const clean = item.trim().split(/\s+as\s+/)[0]?.trim();
          if (clean && !exportsMatches.includes(clean)) exportsMatches.push(clean);
        }
      }
      const fnMatches = [...text.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g)].map(
        (m) => m[1],
      );
      const hasEsm = /\bimport\s+[^;]+\s+from\s+['"]/.test(text) || /\bexport\s+/.test(text);
      const hasCjs = /\brequire\s*\(/.test(text) || /\bmodule\.exports\b/.test(text);

      modules.push({
        path: file.path,
        kind: isCode ? 'code' : isDoc ? 'doc' : 'log',
        lines,
        exports: exportsMatches,
        functions: fnMatches,
        moduleStyle: isDoc ? 'markdown' : hasEsm ? 'esm' : hasCjs ? 'commonjs' : 'other',
      });
    }

    let specSummary = { total: 0, completed: 0, pending: 0 };
    try {
      const tasks = parseSpecTasks(workspace.readFile('spec.md'));
      const completed = tasks.filter((t) => t.completed).length;
      specSummary = { total: tasks.length, completed, pending: tasks.length - completed };
    } catch {
      // Optional spec.md
    }

    return {
      ok: true,
      output: JSON.stringify(
        {
          server: server.name,
          blueprintVersion: '1.0',
          specProgress: specSummary,
          moduleCount: modules.length,
          modules,
        },
        null,
        2,
      ),
    };
  }

  return { ok: false, output: `Outil MCP non implémenté : ${toolName}` };
}
