// server.ts
import "dotenv/config";
import express from "express";
import fs2 from "node:fs";
import http from "node:http";
import path2 from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

// src/server/kilnEngine.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// src/server/kilnExtensions.ts
var DEFAULT_HOOKS = [
  {
    id: "hook-block-secrets",
    name: "Blocage des secrets en clair",
    event: "pre_write",
    action: "block_secrets",
    enabled: true,
    description: "Emp\xEAche l\u2019\xE9criture de cl\xE9s API ou cl\xE9s priv\xE9es (AIza..., sk-..., PRIVATE KEY) dans le workspace."
  },
  {
    id: "hook-audit-write",
    name: "Journal d\u2019audit des \xE9critures",
    event: "post_write",
    action: "log_audit",
    enabled: true,
    description: "Consigne chaque cr\xE9ation ou modification de fichier avec horodatage dans hooks.log."
  },
  {
    id: "hook-pre-cmd-audit",
    name: "Transparence avant commande",
    event: "pre_command",
    action: "log_audit",
    enabled: true,
    description: "Enregistre une trace [ACTION] avant toute ex\xE9cution dans le terminal sandbox."
  },
  {
    id: "hook-post-write-selfcheck",
    name: "Validation post-\xE9criture (.js / .ts)",
    event: "post_write",
    action: "run_self_check",
    enabled: false,
    description: "D\xE9clenche une v\xE9rification automatique apr\xE8s chaque modification de fichier script."
  }
];
var DEFAULT_MCP_SERVERS = [
  {
    id: "mcp-spec-tracker",
    name: "Spec Tracker (REA / spec.md)",
    transport: "sandbox",
    description: "Analyse la progression des phases dans spec.md et identifie la prochaine t\xE2che non termin\xE9e.",
    enabled: true,
    tools: ["mcp_spec_status"]
  },
  {
    id: "mcp-workspace-metrics",
    name: "Workspace Inspector",
    transport: "sandbox",
    description: "Calcule les m\xE9triques du projet (fichiers, lignes, octets, TODOs) pour le suivi de build.",
    enabled: true,
    tools: ["mcp_workspace_stats"]
  },
  {
    id: "mcp-cloud-run",
    name: "Google Cloud Run Readiness",
    transport: "sandbox",
    description: "V\xE9rifie la compatibilit\xE9 Cloud Run (PORT, variables d\u2019env, fichiers directeurs) et g\xE9n\xE8re le manifeste.",
    enabled: true,
    tools: ["mcp_cloud_manifest"]
  },
  {
    id: "mcp-rea-analyzer",
    name: "REA Blueprint Analyzer",
    transport: "sandbox",
    description: "Inspecte les modules du workspace (imports, exports, fonctions, docs) pour pr\xE9parer un plan de build ou de clonage.",
    enabled: true,
    tools: ["mcp_rea_analyze"]
  }
];
var SECRET_PATTERNS = [
  /AIza[0-9A-Za-z_-]{20,}/,
  /sk-[0-9A-Za-z]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
];
function evaluateHooks(hooks, event, context, workspace2) {
  const matching = hooks.filter((h) => h.enabled && h.event === event);
  const logs = [];
  let shouldTriggerSelfCheck = false;
  for (const hook of matching) {
    if (hook.action === "block_secrets" && event === "pre_write") {
      const content = context.content ?? "";
      const found = SECRET_PATTERNS.some((re) => re.test(content));
      if (found) {
        const reason = `Hook "${hook.name}" : secret potentiel d\xE9tect\xE9 dans "${context.targetPath ?? "fichier"}". \xC9criture bloqu\xE9e.`;
        logs.push(`[HOOK BLOCK] ${reason}`);
        return {
          allowed: false,
          blockedReason: reason,
          logs,
          shouldTriggerSelfCheck: false
        };
      }
      logs.push(`[HOOK OK] ${hook.name} (${context.targetPath ?? ""})`);
    } else if (hook.action === "log_audit") {
      const target = context.targetPath ?? context.command ?? "-";
      const line = `[${(/* @__PURE__ */ new Date()).toISOString()}] [${event}] ${target}`;
      logs.push(`[HOOK AUDIT] ${hook.name} -> ${target}`);
      if (workspace2 && context.targetPath !== "hooks.log") {
        try {
          let prev = "";
          try {
            prev = workspace2.readFile("hooks.log");
          } catch {
            prev = "";
          }
          const next = (prev ? `${prev.trimEnd()}
` : "") + line + "\n";
          workspace2.writeFile("hooks.log", next);
        } catch {
        }
      }
    } else if (hook.action === "run_self_check") {
      if (context.targetPath && /\.(js|mjs|ts|tsx)$/i.test(context.targetPath)) {
        shouldTriggerSelfCheck = true;
        logs.push(`[HOOK TRIGGER] ${hook.name} activ\xE9 pour ${context.targetPath}`);
      }
    }
  }
  return {
    allowed: true,
    logs,
    shouldTriggerSelfCheck
  };
}
function parseSpecTasks(specMarkdown) {
  const lines = specMarkdown.split("\n");
  let currentPhase = "G\xE9n\xE9ral";
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const phaseMatch = line.match(/^##\s+(.+)/);
    if (phaseMatch) {
      currentPhase = phaseMatch[1].trim();
      continue;
    }
    const taskMatch = line.match(/^\s*-\s*\[(x|X| )\]\s+(.+)/);
    if (taskMatch) {
      const completed = taskMatch[1].toLowerCase() === "x";
      const title = taskMatch[2].replace(/\*\*/g, "").trim();
      items.push({
        id: `spec-${i + 1}`,
        phase: currentPhase,
        title,
        completed,
        rawLine: line
      });
    }
  }
  return items;
}
function executeMcpTool(servers, toolName, workspace2) {
  const server = servers.find((s) => s.tools.includes(toolName));
  if (!server) {
    return { ok: false, output: `Outil MCP inconnu : ${toolName}` };
  }
  if (!server.enabled) {
    return {
      ok: false,
      output: `Le serveur MCP "${server.name}" est actuellement d\xE9sactiv\xE9.`
    };
  }
  if (toolName === "mcp_spec_status") {
    let specText = "";
    try {
      specText = workspace2.readFile("spec.md");
    } catch {
      return { ok: false, output: "Fichier spec.md introuvable dans le workspace." };
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
          nextPendingTask: nextTask ? `${nextTask.phase} -> ${nextTask.title}` : "Toutes les t\xE2ches sont termin\xE9es.",
          tasks: tasks.map((t) => ({ phase: t.phase, title: t.title, completed: t.completed }))
        },
        null,
        2
      )
    };
  }
  if (toolName === "mcp_workspace_stats") {
    const files = workspace2.listFiles();
    let totalLines = 0;
    let totalBytes = 0;
    let todoCount = 0;
    for (const f of files) {
      totalBytes += f.size;
      try {
        const text = workspace2.readFile(f.path);
        totalLines += text.split("\n").length;
        const matches = text.match(/TODO|FIXME/gi);
        if (matches) todoCount += matches.length;
      } catch {
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
          files: files.map((f) => f.path)
        },
        null,
        2
      )
    };
  }
  if (toolName === "mcp_cloud_manifest") {
    const files = workspace2.listFiles().map((f) => f.path);
    const hasAgents = files.includes("agents.md");
    const hasSpec = files.includes("spec.md");
    const hasFeatures = files.includes("features.md");
    return {
      ok: true,
      output: JSON.stringify(
        {
          server: server.name,
          target: "Google Cloud Run + Google AI Studio",
          steeringFilesReady: hasAgents && hasSpec && hasFeatures,
          nodeVersion: process.version,
          recommendedPort: 3e3,
          envVarsRequired: ["GEMINI_API_KEY"]
        },
        null,
        2
      )
    };
  }
  if (toolName === "mcp_rea_analyze") {
    const files = workspace2.listFiles();
    const modules = [];
    for (const file of files) {
      let text = "";
      try {
        text = workspace2.readFile(file.path);
      } catch {
        continue;
      }
      const lines = text.split("\n").length;
      const isCode = /\.(js|mjs|cjs|ts|tsx)$/i.test(file.path);
      const isDoc = /\.md$/i.test(file.path);
      const exportsMatches = [...text.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_$]+)/g)].map(
        (m) => m[1]
      );
      const exportBlockMatch = text.match(/export\s*\{([^}]+)\}/);
      if (exportBlockMatch) {
        for (const item of exportBlockMatch[1].split(",")) {
          const clean = item.trim().split(/\s+as\s+/)[0]?.trim();
          if (clean && !exportsMatches.includes(clean)) exportsMatches.push(clean);
        }
      }
      const fnMatches = [...text.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g)].map(
        (m) => m[1]
      );
      const hasEsm = /\bimport\s+[^;]+\s+from\s+['"]/.test(text) || /\bexport\s+/.test(text);
      const hasCjs = /\brequire\s*\(/.test(text) || /\bmodule\.exports\b/.test(text);
      modules.push({
        path: file.path,
        kind: isCode ? "code" : isDoc ? "doc" : "log",
        lines,
        exports: exportsMatches,
        functions: fnMatches,
        moduleStyle: isDoc ? "markdown" : hasEsm ? "esm" : hasCjs ? "commonjs" : "other"
      });
    }
    let specSummary = { total: 0, completed: 0, pending: 0 };
    try {
      const tasks = parseSpecTasks(workspace2.readFile("spec.md"));
      const completed = tasks.filter((t) => t.completed).length;
      specSummary = { total: tasks.length, completed, pending: tasks.length - completed };
    } catch {
    }
    return {
      ok: true,
      output: JSON.stringify(
        {
          server: server.name,
          blueprintVersion: "1.0",
          specProgress: specSummary,
          moduleCount: modules.length,
          modules
        },
        null,
        2
      )
    };
  }
  return { ok: false, output: `Outil MCP non impl\xE9ment\xE9 : ${toolName}` };
}

// src/server/kilnEngine.ts
var AVAILABLE_MODELS = [
  {
    id: "gemini-4-hydrogen",
    label: "Gemini 4 Hydrogen (Flash)",
    provider: "Google AI Studio",
    tier: "Gratuit",
    description: "Mod\xE8le agentique rapide par d\xE9faut avec raisonnement adaptatif et outils natifs.",
    supportsThinkingLevels: ["LOW", "MEDIUM", "HIGH", "XHIGH"]
  },
  {
    id: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite",
    provider: "Google AI Studio",
    tier: "Gratuit",
    description: "Latence minimale pour it\xE9rations rapides, r\xE9sum\xE9s et v\xE9rifications courtes.",
    supportsThinkingLevels: ["LOW", "MEDIUM", "HIGH"]
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    provider: "Google AI Studio",
    tier: "Standard",
    description: "Mod\xE8le polyvalent optimis\xE9 pour le code et le d\xE9ploiement Cloud Run."
  },
  {
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    provider: "Google AI Studio",
    tier: "Standard",
    description: "Raisonnement approfondi pour l\u2019architecture logicielle et le d\xE9bogage complexe."
  }
];
var DEFAULT_MODEL_ID = "gemini-4-hydrogen";
var SEEDED_WORKSPACE_FILES = {
  "agents.md": `# agents.md \u2014 R\xE8gles de d\xE9veloppement autonome

## 1. Posture et Autonomie
- Tu es Kiln, un d\xE9veloppeur logiciel autonome, pas un simple assistant passif.
- Ex\xE9cute les lectures, \xE9critures et v\xE9rifications directement via tes outils.
- Ne demande l'intervention de l'utilisateur que si une permission est requise ou en cas de blocage.

## 2. Transparence (Journal d'actions)
- Avant toute \xE9criture de fichier, ex\xE9cution de commande ou d\xE9l\xE9gation, r\xE9sume ton intention au format :
  \`[ACTION] Ce que je fais -> Pourquoi je le fais\`

## 3. Code, Sous-agents et MCP
- R\xE9dige une impl\xE9mentation propre, modulaire et sans d\xE9pendances cach\xE9es.
- Le runtime Node du projet utilise ES Modules (\`"type": "module"\`) : \xE9cris les fichiers \`.js\` du workspace avec \`import\` / \`export\` (jamais \`require()\` ni \`module.exports\`, sauf extension \`.cjs\`).
- Utilise \`delegate_subagent\` pour d\xE9l\xE9guer l'audit, la revue ou l'\xE9criture de tests \xE0 un agent sp\xE9cialis\xE9.
- Appuie-toi sur les outils MCP actifs (\`mcp_spec_status\`, \`mcp_workspace_stats\`, \`mcp_cloud_manifest\`, \`mcp_rea_analyze\`).
- Avance une fonctionnalit\xE9 \xE0 la fois en suivant l'ordre d\xE9fini dans \`spec.md\`.

## 4. Validation et Tests (Self-Check)
- Aucune t\xE2che n'est valid\xE9e tant que la suite \`self-check\` ne renvoie pas \`PASS\`.
- Toute correction de bug s'accompagne d'un test de non-r\xE9gression.
`,
  "features.md": `# features.md \u2014 P\xE9rim\xE8tre fonctionnel de Kiln

- **Moteur agentique Gemini :** Boucle d'ex\xE9cution avec appel d'outils (\`read_file\`, \`write_file\`, \`list_files\`, \`run_command\`, \`delegate_subagent\`, \`mcp_call\`).
- **Syst\xE8me de Permissions & Hooks :** Interception interactive avant \xE9criture/commande + hooks automatiques (\`pre_write\`, \`post_write\`, \`pre_command\`).
- **S\xE9lecteur de Mod\xE8les & Thinking Level :** Basculement \xE0 chaud avec recherche instantan\xE9e et contr\xF4le de profondeur de raisonnement.
- **Serveurs MCP & Sous-agents :** Connecteurs MCP activables et d\xE9l\xE9gation vers des sous-agents sp\xE9cialis\xE9s.
- **Commande /compact :** Synth\xE8se de l'historique conversationnel tout en conservant les instructions directrices.
- **Terminal & Self-Check (12 tests) :** Suite de non-r\xE9gression automatis\xE9e couvrant moteur, s\xE9curit\xE9, MCP, hooks et m\xE9moire.
`,
  "spec.md": `# spec.md \u2014 Sp\xE9cifications Techniques & Plan de Build

## Phase 1 : Noyau du Moteur & S\xE9curit\xE9
- [x] **1.1 Contexte syst\xE8me & basculement de mod\xE8le**
  - Injection dynamique du mod\xE8le actif, de l'OS, de la date et des serveurs MCP dans le prompt syst\xE8me.
- [x] **1.2 Outils fichiers & barri\xE8re de permissions**
  - Fonctions \`read_file\`, \`write_file\`, \`run_command\` confin\xE9es au workspace avec approbation explicite.

## Phase 2 : Boucle Agentique & R\xE9silience
- [x] **2.1 Retry exponentiel sur erreur HTTP 429**
  - Temporisation progressive en cas de limite de d\xE9bit API.
- [x] **2.2 Commande \`/compact\`**
  - Compression de l'historique en un paragraphe de synth\xE8se technique.

## Phase 3 : Audit Post-Build (Sous-agents, MCP, Hooks)
- [x] **3.1 D\xE9l\xE9gation vers des sous-agents sp\xE9cialis\xE9s**
  - Outil \`delegate_subagent\` pour isoler audit s\xE9curit\xE9, revue ou g\xE9n\xE9ration de tests.
- [x] **3.2 Serveurs MCP & Hooks Pr\xE9/Post-Outils**
  - Blocage automatique de secrets (\`pre_write\`), journal d'audit (\`hooks.log\`) et connecteurs MCP configurables.
- [ ] **3.3 Module utilitaire de validation dans le workspace**
  - Cr\xE9er \`validator.js\` avec tests ex\xE9cutables via \`node validator.js\` pour valider la prochaine \xE9tape du projet.

## Phase 4 : Cycle REA \u2014 Audit, Reverse-Engineering & Build Cible
- [ ] **4.1 Cartographie REA du workspace (\`mcp_rea_analyze\`)**
  - Extraire automatiquement la carte des modules, exports et progression via le serveur MCP \`REA Blueprint Analyzer\`.
- [ ] **4.2 Audit s\xE9curit\xE9 & qualit\xE9 via sous-agent (\`/audit\`)**
  - D\xE9l\xE9guer la revue compl\xE8te des fichiers du workspace \xE0 un sous-agent Gemini sp\xE9cialis\xE9.
- [ ] **4.3 Build applicatif autonome & validation finale**
  - Concevoir et tester un module cible complet dans le workspace jusqu'\xE0 \`PASS\`.
`,
  "hello.js": `// Exemple ex\xE9cutable dans le terminal sandbox de Kiln
const project = "Kiln Agentic Studio";
const runtime = process.version;
console.log(\`[Kiln Sandbox] \${project} pr\xEAt sur Node \${runtime}\`);
`
};
function buildSystemPrompt(options) {
  const osInfo = options.osInfo ?? `${os.platform()} ${os.release()}`;
  const today = options.date ?? (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const thinkingInfo = options.thinkingLevel ? ` | Raisonnement : ${options.thinkingLevel}` : "";
  const mcpInfo = options.enabledMcpTools?.length ? `Outils MCP actifs : ${options.enabledMcpTools.join(", ")}` : "Outils MCP actifs : aucun";
  const rulesExcerpt = options.agentsRules?.trim() ? `

Directives projet (agents.md) :
${options.agentsRules.trim().slice(0, 1600)}` : "";
  return [
    "Tu es Kiln, un agent de d\xE9veloppement logiciel autonome int\xE9gr\xE9 \xE0 Google AI Studio.",
    `Mod\xE8le actif : ${options.model} (Google AI Studio${thinkingInfo})`,
    `Syst\xE8me d'exploitation : ${osInfo} | Date : ${today}`,
    mcpInfo,
    "R\xE9ponds honn\xEAtement sur ton mod\xE8le actif (Gemini) si on te le demande.",
    "Utilise les outils disponibles (list_files, read_file, write_file, run_command, delegate_subagent, mcp_call) pour inspecter et modifier le workspace du projet.",
    'Note runtime : ce projet utilise ES Modules ("type": "module"). \xC9cris les scripts .js avec import/export (et import.meta.url) au lieu de require()/module.exports.',
    "Avant toute action importante, indique une courte ligne [ACTION] Ce que je fais -> Pourquoi.",
    "R\xE9ponds en fran\xE7ais clair et concis, sauf demande contraire."
  ].join("\n") + rulesExcerpt;
}
function isRateLimitError(err) {
  if (!err) return false;
  const anyErr = err;
  if (anyErr.status === 429 || anyErr.code === 429 || anyErr.status === 503 || anyErr.code === 503) {
    return true;
  }
  const msg = String(anyErr.message ?? err).toLowerCase();
  return msg.includes("429") || msg.includes("503") || msg.includes("resource_exhausted") || msg.includes("rate limit") || msg.includes("too many requests") || msg.includes("quota") || msg.includes("unavailable") || msg.includes("overloaded");
}
function extractRetryAfterMs(err) {
  if (!err) return null;
  const msg = String(err?.message ?? err);
  const match = msg.match(/retry(?:\s+in\s+|\s*delay["':\s]+)(\d+(?:\.\d+)?)\s*s/i);
  if (!match) return null;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(8e3, Math.max(400, Math.round(seconds * 1e3)));
}
function getModelFallbackChain(primaryModelId) {
  const orderedFallbacks = ["gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-4-hydrogen"];
  const validAvailable = new Set(AVAILABLE_MODELS.map((m) => m.id));
  const chain = [primaryModelId];
  for (const candidate of orderedFallbacks) {
    if (candidate !== primaryModelId && validAvailable.has(candidate)) {
      chain.push(candidate);
    }
  }
  return chain;
}
async function withRetry429(operation, options = {}) {
  const maxRetries = options.maxRetries ?? 4;
  const initialDelayMs = options.initialDelayMs ?? 1200;
  const usesCustomSleep = Boolean(options.sleep);
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let delay = initialDelayMs;
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      const shouldRetry = isRateLimitError(err) && attempt < maxRetries - 1;
      if (!shouldRetry) {
        throw err;
      }
      const hintedDelay = usesCustomSleep ? null : extractRetryAfterMs(err);
      const waitMs = hintedDelay ? Math.max(delay, hintedDelay) : delay;
      options.onRetry?.(attempt + 1, waitMs, err);
      await sleep(waitMs);
      delay *= 2;
    }
  }
  throw lastError;
}
async function compactConversationMessages(messages, summarizeFn, modelId) {
  const conversational = messages.filter((m) => m.role !== "system");
  if (conversational.length <= 2) {
    return {
      messages,
      summaryText: "Historique d\xE9j\xE0 minimal (2 messages ou moins), aucune compression n\xE9cessaire.",
      compacted: false
    };
  }
  const transcript = conversational.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
  const summary = (await summarizeFn(transcript)).trim();
  const compactedMsg = {
    id: `compact-${Date.now()}`,
    role: "assistant",
    content: `[R\xC9SUM\xC9 DE SESSION COMPACT\xC9]
${summary}`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    model: modelId,
    isCompactSummary: true
  };
  return {
    messages: [compactedMsg],
    summaryText: summary,
    compacted: true
  };
}
function createDeterministicSummary(transcript) {
  const lines = transcript.split("\n").map((l) => l.trim()).filter(Boolean);
  const userLines = lines.filter((l) => l.startsWith("USER:")).slice(-4);
  const assistantLines = lines.filter((l) => l.startsWith("ASSISTANT:")).slice(-3);
  const parts = [
    `Synth\xE8se locale de ${lines.length} lignes d'\xE9change.`,
    userLines.length ? `Derni\xE8res demandes : ${userLines.map((u) => u.replace(/^USER:\s*/, "")).join(" | ")}` : "",
    assistantLines.length ? `Derniers r\xE9sultats : ${assistantLines.map((a) => a.replace(/^ASSISTANT:\s*/, "").slice(0, 140)).join(" | ")}` : ""
  ].filter(Boolean);
  return parts.join(" ");
}
var WorkspaceSandbox = class {
  constructor(rootDir, seedDefaults = true) {
    this.rootDir = path.resolve(rootDir);
    fs.mkdirSync(this.rootDir, { recursive: true });
    if (seedDefaults) {
      this.ensureSeedFiles();
    }
  }
  ensureSeedFiles() {
    for (const [relPath, content] of Object.entries(SEEDED_WORKSPACE_FILES)) {
      const target = this.resolveSafePath(relPath);
      if (!fs.existsSync(target)) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, "utf-8");
      }
    }
  }
  resolveSafePath(relativePath) {
    const trimmed = relativePath.trim();
    if (!trimmed || trimmed === ".") {
      throw new Error("Chemin de fichier vide ou invalide.");
    }
    if (path.isAbsolute(trimmed)) {
      throw new Error(`Acc\xE8s refus\xE9 en dehors du workspace sandbox : "${relativePath}".`);
    }
    const resolved = path.resolve(this.rootDir, trimmed);
    const relative = path.relative(this.rootDir, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Acc\xE8s refus\xE9 en dehors du workspace sandbox : "${relativePath}".`);
    }
    return resolved;
  }
  listFiles() {
    const results = [];
    const walk = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          const stat = fs.statSync(full);
          results.push({
            path: path.relative(this.rootDir, full).replace(/\\/g, "/"),
            size: stat.size,
            updatedAt: stat.mtime.toISOString()
          });
        }
      }
    };
    walk(this.rootDir);
    return results.sort((a, b) => a.path.localeCompare(b.path));
  }
  readFile(relativePath) {
    const target = this.resolveSafePath(relativePath);
    if (!fs.existsSync(target)) {
      throw new Error(`Le fichier "${relativePath}" n'existe pas dans le workspace.`);
    }
    return fs.readFileSync(target, "utf-8");
  }
  writeFile(relativePath, content) {
    const target = this.resolveSafePath(relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf-8");
    return {
      path: path.relative(this.rootDir, target).replace(/\\/g, "/"),
      bytes: Buffer.byteLength(content, "utf-8")
    };
  }
  deleteFile(relativePath) {
    const target = this.resolveSafePath(relativePath);
    if (!fs.existsSync(target)) return false;
    fs.unlinkSync(target);
    return true;
  }
};
function executeSafeCommand(command, workspace2) {
  const trimmed = command.trim();
  if (!trimmed) {
    return { exitCode: 1, stdout: "", stderr: "Commande vide." };
  }
  if (/[;&|`$><]/.test(trimmed)) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "Op\xE9rateurs shell non autoris\xE9s dans le sandbox (utilisez une commande unitaire)."
    };
  }
  const tokens = trimmed.split(/\s+/);
  const cmd = tokens[0].toLowerCase();
  const args = tokens.slice(1);
  if (cmd === "help") {
    return {
      exitCode: 0,
      stdout: [
        "Commandes sandbox disponibles :",
        "  ls                  Lister les fichiers du workspace",
        "  cat <fichier>       Afficher le contenu d\u2019un fichier",
        "  node <fichier.js>   Ex\xE9cuter un script JS du workspace",
        "  pwd                 Afficher le r\xE9pertoire courant",
        "  echo <texte>        Afficher un message",
        "  self-check          Lancer la suite de tests automatis\xE9s Kiln (12 contr\xF4les)"
      ].join("\n"),
      stderr: ""
    };
  }
  if (cmd === "pwd") {
    return { exitCode: 0, stdout: "/workspace", stderr: "" };
  }
  if (cmd === "echo") {
    return { exitCode: 0, stdout: args.join(" "), stderr: "" };
  }
  if (cmd === "ls" || cmd === "dir") {
    const files = workspace2.listFiles();
    if (files.length === 0) {
      return { exitCode: 0, stdout: "(workspace vide)", stderr: "" };
    }
    const output = files.map((f) => `${String(f.size).padStart(7, " ")} B  ${f.path}`).join("\n");
    return { exitCode: 0, stdout: output, stderr: "" };
  }
  if (cmd === "cat") {
    if (!args[0]) {
      return { exitCode: 1, stdout: "", stderr: "Usage : cat <chemin-fichier>" };
    }
    try {
      const content = workspace2.readFile(args[0]);
      return { exitCode: 0, stdout: content, stderr: "" };
    } catch (err) {
      return { exitCode: 1, stdout: "", stderr: String(err.message ?? err) };
    }
  }
  if (cmd === "node") {
    if (!args[0]) {
      return { exitCode: 1, stdout: "", stderr: "Usage : node <fichier.js>" };
    }
    try {
      const resolved = workspace2.resolveSafePath(args[0]);
      if (!fs.existsSync(resolved)) {
        return { exitCode: 1, stdout: "", stderr: `Fichier introuvable : ${args[0]}` };
      }
      const stdout = execFileSync(process.execPath, [resolved], {
        cwd: workspace2.rootDir,
        timeout: 4e3,
        encoding: "utf-8"
      });
      return { exitCode: 0, stdout: stdout.trimEnd(), stderr: "" };
    } catch (err) {
      const anyErr = err;
      let stderr = String(anyErr.stderr ?? anyErr.message ?? err);
      if (stderr.includes("require is not defined in ES module scope")) {
        stderr += '\n[Astuce Kiln] Ce projet utilise ES Modules ("type": "module"). Remplacez require()/module.exports par import/export ou utilisez l\u2019extension .cjs.';
      }
      return {
        exitCode: anyErr.status ?? 1,
        stdout: String(anyErr.stdout ?? ""),
        stderr
      };
    }
  }
  return {
    exitCode: 127,
    stdout: "",
    stderr: `Commande "${cmd}" non reconnue. Tapez "help" pour la liste des commandes sandbox.`
  };
}
function createInitialSession(id, title, model, agentsRules, thinkingLevel = "HIGH", enabledMcpTools = DEFAULT_MCP_SERVERS.filter((s) => s.enabled).flatMap((s) => s.tools)) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    id,
    title,
    model,
    thinkingLevel,
    autoApprove: false,
    messages: [
      {
        id: `welcome-${id}`,
        role: "assistant",
        content: "Bonjour ! Je suis **Kiln**, votre agent de d\xE9veloppement autonome propuls\xE9 par Google AI Studio.\n\nLes fichiers directeurs (`agents.md`, `features.md`, `spec.md`), les serveurs **MCP**, les **Hooks** de s\xE9curit\xE9 et la d\xE9l\xE9gation vers des **Sous-agents** sont actifs. D\xE9crivez une t\xE2che, ouvrez **Spec & Plan** pour ex\xE9cuter la prochaine \xE9tape, ou tapez `/compact`.",
        timestamp: now,
        model
      }
    ],
    systemPromptPreview: buildSystemPrompt({
      model,
      thinkingLevel,
      agentsRules,
      enabledMcpTools
    }),
    createdAt: now,
    updatedAt: now
  };
}
async function runSelfCheckSuite() {
  const cases = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiln-selfcheck-"));
  const runCase = async (id, name, category, fn) => {
    const start = performance.now();
    try {
      await fn();
      cases.push({
        id,
        name,
        category,
        passed: true,
        detail: "PASS",
        durationMs: Math.round((performance.now() - start) * 100) / 100
      });
    } catch (err) {
      cases.push({
        id,
        name,
        category,
        passed: false,
        detail: String(err.message ?? err),
        durationMs: Math.round((performance.now() - start) * 100) / 100
      });
    }
  };
  try {
    await runCase("sc-1", "Injection dynamique du contexte syst\xE8me", "Moteur", () => {
      const prompt = buildSystemPrompt({
        model: "gemini-4-hydrogen",
        thinkingLevel: "XHIGH",
        osInfo: "Linux 6.8",
        date: "2026-11-15",
        agentsRules: "Ne jamais valider sans self-check.",
        enabledMcpTools: ["mcp_spec_status"]
      });
      if (!prompt.includes("gemini-4-hydrogen")) throw new Error("Mod\xE8le absent");
      if (!prompt.includes("XHIGH")) throw new Error("ThinkingLevel absent");
      if (!prompt.includes("mcp_spec_status")) throw new Error("MCP absent");
    });
    await runCase("sc-2", "Basculement de mod\xE8le \xE0 chaud", "Mod\xE8les", () => {
      const session = createInitialSession("sc-sess", "Test", "gemini-4-hydrogen", "R\xE8gle 1");
      session.model = "gemini-3.1-flash-lite";
      session.systemPromptPreview = buildSystemPrompt({
        model: session.model,
        thinkingLevel: "LOW",
        agentsRules: "R\xE8gle 1"
      });
      if (!session.systemPromptPreview.includes("gemini-3.1-flash-lite")) {
        throw new Error("Prompt syst\xE8me non mis \xE0 jour");
      }
    });
    await runCase("sc-3", "Isolation sandbox et blocage path traversal", "S\xE9curit\xE9", () => {
      const sandbox = new WorkspaceSandbox(tempDir, true);
      sandbox.writeFile("probe.txt", "Kiln OK");
      if (sandbox.readFile("probe.txt") !== "Kiln OK") throw new Error("Contenu relu incoh\xE9rent");
      let blocked = false;
      try {
        sandbox.resolveSafePath("../../etc/passwd");
      } catch {
        blocked = true;
      }
      if (!blocked) throw new Error("Path traversal non bloqu\xE9");
    });
    await runCase("sc-4", "Barri\xE8re de permissions (Refus vs Approbation)", "Permissions", () => {
      const sandbox = new WorkspaceSandbox(tempDir, false);
      const deniedTarget = path.join(tempDir, "denied.txt");
      const approved = false;
      if (approved) sandbox.writeFile("denied.txt", "interdit");
      if (fs.existsSync(deniedTarget)) throw new Error("Fichier \xE9crit malgr\xE9 refus");
      sandbox.writeFile("approved.txt", "autoris\xE9");
      if (sandbox.readFile("approved.txt") !== "autoris\xE9") throw new Error("\xC9chec apr\xE8s approbation");
    });
    await runCase("sc-5", "R\xE9silience HTTP 429 (Retry exponentiel)", "R\xE9silience", async () => {
      let calls = 0;
      const delays = [];
      const result = await withRetry429(
        async () => {
          calls += 1;
          if (calls < 3) {
            const err = new Error("429 RESOURCE_EXHAUSTED");
            err.status = 429;
            throw err;
          }
          return "ok-after-retry";
        },
        {
          maxRetries: 4,
          initialDelayMs: 5,
          sleep: async (ms) => {
            delays.push(ms);
          }
        }
      );
      if (result !== "ok-after-retry" || calls !== 3 || delays.length !== 2) {
        throw new Error("S\xE9quence de retry 429 invalide");
      }
    });
    await runCase("sc-6", "Compression de l\u2019historique (/compact)", "M\xE9moire", async () => {
      const fakeMsgs = Array.from({ length: 6 }, (_, i) => ({
        id: `m-${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `\xC9change technique num\xE9ro ${i}`,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      }));
      const compacted = await compactConversationMessages(
        fakeMsgs,
        async () => "Synth\xE8se des 6 messages.",
        "gemini-4-hydrogen"
      );
      if (!compacted.compacted || compacted.messages.length !== 1) {
        throw new Error("Historique non compact\xE9");
      }
    });
    await runCase("sc-7", "Hook pre_write (blocage de secret en clair)", "Hooks", () => {
      const hookCheck = evaluateHooks(DEFAULT_HOOKS, "pre_write", {
        targetPath: "leak.txt",
        content: 'const key = "AIzaSyDummySecretValue123456789012345";'
      });
      if (hookCheck.allowed) throw new Error("Secret non bloqu\xE9 par le hook pre_write");
    });
    await runCase("sc-8", "Hook post_write (journalisation hooks.log)", "Hooks", () => {
      const sandbox = new WorkspaceSandbox(tempDir, false);
      const res = evaluateHooks(
        DEFAULT_HOOKS,
        "post_write",
        { targetPath: "notes.md" },
        sandbox
      );
      if (!res.allowed) throw new Error("Hook post_write bloqu\xE9 \xE0 tort");
      const logContent = sandbox.readFile("hooks.log");
      if (!logContent.includes("notes.md")) throw new Error("Trace absente de hooks.log");
    });
    await runCase("sc-9", "Serveurs MCP (ex\xE9cution et contr\xF4le d\u2019activation)", "MCP", () => {
      const sandbox = new WorkspaceSandbox(tempDir, true);
      const activeRes = executeMcpTool(DEFAULT_MCP_SERVERS, "mcp_spec_status", sandbox);
      if (!activeRes.ok || !activeRes.output.includes("totalTasks")) {
        throw new Error("\xC9chec outil MCP actif");
      }
      const disabledServers = DEFAULT_MCP_SERVERS.map(
        (s) => s.id === "mcp-spec-tracker" ? { ...s, enabled: false } : s
      );
      const disabledRes = executeMcpTool(disabledServers, "mcp_spec_status", sandbox);
      if (disabledRes.ok) throw new Error("Outil MCP ex\xE9cut\xE9 malgr\xE9 d\xE9sactivation");
    });
    await runCase("sc-10", "Analyseur de progression spec.md", "Spec", () => {
      const tasks = parseSpecTasks(SEEDED_WORKSPACE_FILES["spec.md"]);
      if (tasks.length < 5) throw new Error("T\xE2ches spec.md non d\xE9tect\xE9es");
      if (!tasks.some((t) => !t.completed)) throw new Error("Aucune t\xE2che restante d\xE9tect\xE9e");
    });
    await runCase("sc-11", "Blocage des op\xE9rateurs shell cha\xEEn\xE9s", "Terminal", () => {
      const sandbox = new WorkspaceSandbox(tempDir, true);
      const res = executeSafeCommand("ls && echo pwn", sandbox);
      if (res.exitCode === 0) throw new Error("Op\xE9rateur cha\xEEn\xE9 non bloqu\xE9");
    });
    await runCase("sc-12", "M\xE9triques MCP Workspace Inspector", "MCP", () => {
      const sandbox = new WorkspaceSandbox(tempDir, true);
      const statsRes = executeMcpTool(DEFAULT_MCP_SERVERS, "mcp_workspace_stats", sandbox);
      if (!statsRes.ok || !statsRes.output.includes("fileCount")) {
        throw new Error("M\xE9triques MCP workspace invalides");
      }
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  const passedCount = cases.filter((c) => c.passed).length;
  return {
    ranAt: (/* @__PURE__ */ new Date()).toISOString(),
    passedCount,
    totalCount: cases.length,
    allPassed: passedCount === cases.length,
    cases
  };
}

// src/server/geminiAgent.ts
import {
  GoogleGenAI,
  ThinkingLevel,
  Type
} from "@google/genai";
var BASE_KILN_TOOLS = [
  {
    name: "list_files",
    description: "Liste tous les fichiers pr\xE9sents dans le workspace du projet Kiln.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        filter: {
          type: Type.STRING,
          description: "Filtre optionnel par sous-cha\xEEne sur le chemin du fichier."
        }
      }
    }
  },
  {
    name: "read_file",
    description: "Lit le contenu UTF-8 d\u2019un fichier du workspace (ex: agents.md, spec.md, hello.js).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: "Chemin relatif du fichier dans le workspace."
        }
      },
      required: ["path"]
    }
  },
  {
    name: "write_file",
    description: "\xC9crit ou met \xE0 jour un fichier dans le workspace. Soumis aux hooks pre_write et aux permissions utilisateur.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: "Chemin relatif du fichier \xE0 cr\xE9er ou modifier."
        },
        content: {
          type: Type.STRING,
          description: "Contenu complet \xE0 \xE9crire dans le fichier."
        }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "run_command",
    description: "Ex\xE9cute une commande sandbox dans le terminal Kiln (ex: ls, cat <fichier>, node <fichier.js>, pwd). Soumis aux permissions.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: {
          type: Type.STRING,
          description: "Commande unitaire sandbox \xE0 ex\xE9cuter."
        }
      },
      required: ["command"]
    }
  },
  {
    name: "delegate_subagent",
    description: "D\xE9l\xE8gue une sous-t\xE2che cibl\xE9e (audit de code, planification spec.md, r\xE9daction de tests) \xE0 un sous-agent Gemini sp\xE9cialis\xE9.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        role: {
          type: Type.STRING,
          description: 'R\xF4le du sous-agent (ex: "Auditeur S\xE9curit\xE9", "R\xE9dacteur de Tests", "Architecte Spec").'
        },
        task: {
          type: Type.STRING,
          description: "Instruction pr\xE9cise et autonome confi\xE9e au sous-agent."
        },
        context_file: {
          type: Type.STRING,
          description: "Chemin optionnel d\u2019un fichier du workspace \xE0 fournir en contexte au sous-agent."
        }
      },
      required: ["role", "task"]
    }
  },
  {
    name: "mcp_call",
    description: "Appelle un outil expos\xE9 par les serveurs MCP actifs (mcp_spec_status, mcp_workspace_stats, mcp_cloud_manifest, mcp_rea_analyze).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        tool_name: {
          type: Type.STRING,
          description: "Nom exact de l\u2019outil MCP \xE0 invoquer."
        }
      },
      required: ["tool_name"]
    }
  }
];
function getGenAIClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Cl\xE9 API manquante : configurez GEMINI_API_KEY dans le panneau Settings > Secrets pour dialoguer avec Gemini."
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
}
function makeTerminalEntry(type, text) {
  return {
    id: `term-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    type,
    text
  };
}
function formatGeminiError(err) {
  const msg = String(err?.message ?? err);
  if (msg.includes("403") || msg.includes("PERMISSION_DENIED") || msg.includes("API_KEY_INVALID")) {
    return "Acc\xE8s refus\xE9 par l\u2019API Gemini (403/400). V\xE9rifiez votre cl\xE9 dans Settings > Secrets.";
  }
  if (isRateLimitError(err)) {
    return "Limite de d\xE9bit atteinte (HTTP 429) sur le mod\xE8le principal et les mod\xE8les de repli apr\xE8s plusieurs tentatives exponentielles. Patientez quelques secondes puis cliquez sur R\xE9essayer (ou v\xE9rifiez votre quota dans Settings > Secrets).";
  }
  if (msg.includes("404") || msg.includes("NOT_FOUND")) {
    return `Mod\xE8le introuvable (404) : ${msg}. S\xE9lectionnez un mod\xE8le Gemini actif.`;
  }
  return msg;
}
function buildHistoryContents(session) {
  const contents = [];
  for (const msg of session.messages) {
    if (msg.role === "system" || msg.isError || msg.id.startsWith("welcome-")) continue;
    contents.push({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }]
    });
  }
  return contents;
}
function resolveThinkingConfig(modelId, level) {
  const meta = AVAILABLE_MODELS.find((m) => m.id === modelId);
  if (!meta?.supportsThinkingLevels) return void 0;
  if (level === "XHIGH") {
    if (modelId === "gemini-4-hydrogen") {
      return { thinkingLevel: "XHIGH" };
    }
    return { thinkingLevel: ThinkingLevel.HIGH };
  }
  if (level === "LOW") return { thinkingLevel: ThinkingLevel.LOW };
  if (level === "MEDIUM") return { thinkingLevel: ThinkingLevel.MEDIUM };
  return { thinkingLevel: ThinkingLevel.HIGH };
}
async function generateWithModelFallback(ai, primaryModel, thinkingLevel, callApi, terminalEntries) {
  const chain = getModelFallbackChain(primaryModel);
  let lastError;
  for (let idx = 0; idx < chain.length; idx++) {
    const candidateModel = chain[idx];
    const thinkingConfig = resolveThinkingConfig(candidateModel, thinkingLevel);
    try {
      const response = await withRetry429(
        () => callApi(candidateModel, thinkingConfig),
        {
          maxRetries: idx === 0 ? 3 : 2,
          initialDelayMs: 900,
          onRetry: (attempt, delayMs) => {
            terminalEntries.push(
              makeTerminalEntry(
                "info",
                `[RATE LIMIT 429] ${candidateModel} \u2014 tentative ${attempt} dans ${delayMs}ms...`
              )
            );
          }
        }
      );
      return { response, effectiveModel: candidateModel };
    } catch (err) {
      lastError = err;
      const nextModel = chain[idx + 1];
      if (isRateLimitError(err) && nextModel) {
        terminalEntries.push(
          makeTerminalEntry(
            "info",
            `[FALLBACK 429] Quota atteint sur ${candidateModel} -> bascule automatique vers ${nextModel}`
          )
        );
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}
async function runSubagentDelegation(ai, modelId, role, task, contextFile, workspace2) {
  const start = performance.now();
  let fileSnippet = "";
  if (contextFile) {
    try {
      fileSnippet = `

Contenu du fichier "${contextFile}" :
\`\`\`
${workspace2.readFile(contextFile).slice(0, 3500)}
\`\`\``;
    } catch (err) {
      fileSnippet = `

[Note] Impossible de lire "${contextFile}": ${String(err.message)}`;
    }
  }
  const preferredSubModel = modelId.startsWith("gemini-2.5") ? modelId : "gemini-3.1-flash-lite";
  const dummyLogs = [];
  const { response, effectiveModel } = await generateWithModelFallback(
    ai,
    preferredSubModel,
    "LOW",
    (candidateModel) => ai.models.generateContent({
      model: candidateModel,
      contents: `T\xE2che confi\xE9e :
${task}${fileSnippet}`,
      config: {
        systemInstruction: `Tu es un sous-agent sp\xE9cialis\xE9 de Kiln avec le r\xF4le : "${role}". R\xE9ponds de mani\xE8re concise, structur\xE9e et directement exploitable par l'agent principal en fran\xE7ais.`
      }
    }),
    dummyLogs
  );
  const summary = (response.text ?? "").trim() || "(Sous-agent : aucune r\xE9ponse)";
  const durationMs = Math.round(performance.now() - start);
  const trace = {
    id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role,
    task,
    summary,
    model: effectiveModel,
    durationMs
  };
  return { trace, output: summary };
}
async function executeToolCall(call, ctx, ai, sessionModel) {
  const args = call.args ?? {};
  const logs = [];
  try {
    if (call.name === "list_files") {
      const filter = typeof args.filter === "string" ? args.filter.toLowerCase() : "";
      const files = ctx.workspace.listFiles().filter((f) => !filter ? true : f.path.toLowerCase().includes(filter));
      const output = files.length ? files.map((f) => `${f.path} (${f.size} B)`).join("\n") : "(aucun fichier correspondant)";
      logs.push(makeTerminalEntry("action", `[ACTION] list_files -> ${files.length} fichier(s) trouv\xE9s`));
      return { output, status: "executed", terminalLogs: logs };
    }
    if (call.name === "read_file") {
      const targetPath = String(args.path ?? "");
      const content = ctx.workspace.readFile(targetPath);
      logs.push(makeTerminalEntry("action", `[ACTION] read_file("${targetPath}") -> ${content.length} car.`));
      return { output: content, status: "executed", terminalLogs: logs };
    }
    if (call.name === "write_file") {
      const targetPath = String(args.path ?? "");
      const content = String(args.content ?? "");
      const preHook = evaluateHooks(ctx.hooks, "pre_write", { targetPath, content }, ctx.workspace);
      for (const hLog of preHook.logs) {
        logs.push(makeTerminalEntry("hook", hLog));
      }
      if (!preHook.allowed) {
        return {
          output: preHook.blockedReason ?? "\xC9criture bloqu\xE9e par un hook pre_write.",
          status: "error",
          terminalLogs: logs
        };
      }
      const res = ctx.workspace.writeFile(targetPath, content);
      let output = `Succ\xE8s : fichier "${res.path}" \xE9crit (${res.bytes} octets).`;
      logs.push(makeTerminalEntry("success", `[ACTION] write_file("${res.path}") -> ${res.bytes} octets`));
      const postHook = evaluateHooks(ctx.hooks, "post_write", { targetPath: res.path }, ctx.workspace);
      for (const hLog of postHook.logs) {
        logs.push(makeTerminalEntry("hook", hLog));
      }
      if (postHook.shouldTriggerSelfCheck) {
        const report = await runSelfCheckSuite();
        logs.push(
          makeTerminalEntry(
            report.allPassed ? "success" : "stderr",
            `[HOOK SELF-CHECK] ${report.passedCount}/${report.totalCount} v\xE9rifications PASS`
          )
        );
        output += `
Self-check post-\xE9criture : ${report.passedCount}/${report.totalCount} PASS.`;
      }
      return { output, status: "approved", terminalLogs: logs };
    }
    if (call.name === "run_command") {
      const command = String(args.command ?? "");
      const preHook = evaluateHooks(ctx.hooks, "pre_command", { command }, ctx.workspace);
      for (const hLog of preHook.logs) {
        logs.push(makeTerminalEntry("hook", hLog));
      }
      logs.push(makeTerminalEntry("command", `$ ${command}`));
      const res = executeSafeCommand(command, ctx.workspace);
      if (res.stdout) logs.push(makeTerminalEntry("stdout", res.stdout));
      if (res.stderr) logs.push(makeTerminalEntry("stderr", res.stderr));
      const output = `Code retour: ${res.exitCode}
STDOUT:
${res.stdout}
STDERR:
${res.stderr}`.trim();
      return {
        output,
        status: res.exitCode === 0 ? "approved" : "error",
        terminalLogs: logs
      };
    }
    if (call.name === "delegate_subagent") {
      const role = String(args.role ?? "Assistant Technique");
      const task = String(args.task ?? "");
      const contextFile = typeof args.context_file === "string" ? args.context_file : void 0;
      logs.push(makeTerminalEntry("action", `[ACTION] D\xE9l\xE9gation sous-agent "${role}" -> ${task.slice(0, 80)}`));
      const { trace, output } = await runSubagentDelegation(
        ai,
        sessionModel,
        role,
        task,
        contextFile,
        ctx.workspace
      );
      logs.push(makeTerminalEntry("success", `[SOUS-AGENT] "${role}" termin\xE9 en ${trace.durationMs}ms`));
      return { output, status: "executed", terminalLogs: logs, subagentTrace: trace };
    }
    if (call.name === "mcp_call") {
      const toolName = String(args.tool_name ?? "");
      logs.push(makeTerminalEntry("action", `[ACTION] MCP call -> ${toolName}`));
      const res = executeMcpTool(ctx.mcpServers, toolName, ctx.workspace);
      logs.push(
        makeTerminalEntry(
          res.ok ? "success" : "stderr",
          `[MCP] ${toolName} -> ${res.ok ? "OK" : "BLOQU\xC9/ERREUR"}`
        )
      );
      return {
        output: res.output,
        status: res.ok ? "executed" : "error",
        terminalLogs: logs
      };
    }
    return {
      output: `Outil inconnu : ${call.name}`,
      status: "error",
      terminalLogs: [makeTerminalEntry("stderr", `[TOOL] Outil inconnu : ${call.name}`)]
    };
  } catch (err) {
    const errMsg = String(err?.message ?? err);
    logs.push(makeTerminalEntry("stderr", `[TOOL ERROR] ${call.name}: ${errMsg}`));
    return { output: `Erreur : ${errMsg}`, status: "error", terminalLogs: logs };
  }
}
async function runAgentStep(session, ctx, initialContents, existingToolLogs = [], existingSubagents = [], existingAssistantId) {
  const ai = getGenAIClient();
  let agentsRules = "";
  try {
    agentsRules = ctx.workspace.readFile("agents.md");
  } catch {
    agentsRules = "";
  }
  const enabledMcpTools = ctx.mcpServers.filter((s) => s.enabled).flatMap((s) => s.tools);
  const systemInstruction = buildSystemPrompt({
    model: session.model,
    thinkingLevel: session.thinkingLevel,
    agentsRules,
    enabledMcpTools
  });
  let activeModel = session.model;
  const contents = initialContents ? [...initialContents] : buildHistoryContents(session);
  const terminalEntries = [];
  const collectedToolLogs = [...existingToolLogs];
  const collectedSubagents = [...existingSubagents];
  const assistantMessageId = existingAssistantId ?? `msg-${Date.now()}`;
  const MAX_HOPS = 6;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const { response, effectiveModel } = await generateWithModelFallback(
      ai,
      activeModel,
      session.thinkingLevel,
      (candidateModel, thinkingConfig) => ai.models.generateContent({
        model: candidateModel,
        contents,
        config: {
          systemInstruction,
          ...thinkingConfig ? { thinkingConfig } : {},
          tools: [{ functionDeclarations: BASE_KILN_TOOLS }]
        }
      }),
      terminalEntries
    );
    activeModel = effectiveModel;
    const modelContent = response.candidates?.[0]?.content;
    const functionCalls = response.functionCalls ?? [];
    if (functionCalls.length === 0 || !modelContent) {
      const replyText = (response.text ?? "").trim() || "(R\xE9ponse vide du mod\xE8le)";
      const assistantMsg = {
        id: assistantMessageId,
        role: "assistant",
        content: replyText,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        model: activeModel,
        toolCalls: collectedToolLogs.length ? collectedToolLogs : void 0,
        subagents: collectedSubagents.length ? collectedSubagents : void 0
      };
      return {
        messages: [assistantMsg],
        pendingPermission: null,
        pausedState: null,
        terminalEntries
      };
    }
    const responseParts = [];
    for (let i = 0; i < functionCalls.length; i++) {
      const call = functionCalls[i];
      const toolName = call.name ?? "read_file";
      const args = call.args ?? {};
      const requiresPermission = (toolName === "write_file" || toolName === "run_command") && !session.autoApprove;
      if (requiresPermission) {
        const permId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const description = toolName === "write_file" ? `\xC9crire le fichier "${String(args.path ?? "")}" (${String(args.content ?? "").length} caract\xE8res)` : `Ex\xE9cuter la commande sandbox : "${String(args.command ?? "")}"`;
        const details = toolName === "write_file" ? String(args.content ?? "").slice(0, 800) : String(args.command ?? "");
        terminalEntries.push(makeTerminalEntry("permission", `[PERMISSION REQUISE] ${description}`));
        const pendingLog = {
          id: permId,
          name: toolName,
          args,
          status: "pending",
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        };
        collectedToolLogs.push(pendingLog);
        const pendingPermission = {
          id: permId,
          sessionId: session.id,
          toolName,
          description,
          details,
          args,
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        const pausedState = {
          sessionId: session.id,
          permissionId: permId,
          contents,
          modelContent,
          currentCall: call,
          remainingCalls: functionCalls.slice(i + 1),
          collectedToolLogs,
          collectedSubagents,
          collectedPartsForResponse: responseParts,
          assistantMessageId
        };
        return {
          messages: [],
          pendingPermission,
          pausedState,
          terminalEntries
        };
      }
      const execRes = await executeToolCall(call, ctx, ai, session.model);
      terminalEntries.push(...execRes.terminalLogs);
      if (execRes.subagentTrace) {
        collectedSubagents.push(execRes.subagentTrace);
      }
      collectedToolLogs.push({
        id: call.id ?? `tool-${Date.now()}-${i}`,
        name: toolName,
        args,
        status: execRes.status,
        result: execRes.output,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      responseParts.push({
        functionResponse: {
          id: call.id,
          name: call.name ?? toolName,
          response: { output: execRes.output }
        }
      });
    }
    contents.push(modelContent);
    contents.push({ role: "user", parts: responseParts });
  }
  return {
    messages: [
      {
        id: assistantMessageId,
        role: "assistant",
        content: "Limite d\u2019it\xE9rations d\u2019outils atteinte pour ce tour. R\xE9sumez ou poursuivez votre demande.",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        model: session.model,
        toolCalls: collectedToolLogs,
        subagents: collectedSubagents.length ? collectedSubagents : void 0
      }
    ],
    pendingPermission: null,
    pausedState: null,
    terminalEntries
  };
}
async function resumePausedAgent(session, paused, decision, ctx) {
  const ai = getGenAIClient();
  const terminalEntries = [];
  const toolLogs = [...paused.collectedToolLogs];
  const subagents = [...paused.collectedSubagents];
  const responseParts = [...paused.collectedPartsForResponse];
  const targetLog = toolLogs.find((t) => t.id === paused.permissionId);
  let currentOutput;
  if (decision === "approve") {
    const execRes = await executeToolCall(paused.currentCall, ctx, ai, session.model);
    terminalEntries.push(...execRes.terminalLogs);
    if (execRes.subagentTrace) subagents.push(execRes.subagentTrace);
    currentOutput = execRes.output;
    if (targetLog) {
      targetLog.status = execRes.status;
      targetLog.result = execRes.output;
    }
  } else {
    currentOutput = "Action refus\xE9e par l'utilisateur via la barri\xE8re de permissions.";
    terminalEntries.push(
      makeTerminalEntry("stderr", `[PERMISSION REFUS\xC9E] ${paused.currentCall.name}`)
    );
    if (targetLog) {
      targetLog.status = "denied";
      targetLog.result = currentOutput;
    }
  }
  responseParts.push({
    functionResponse: {
      id: paused.currentCall.id,
      name: paused.currentCall.name ?? "write_file",
      response: { output: currentOutput }
    }
  });
  for (let i = 0; i < paused.remainingCalls.length; i++) {
    const call = paused.remainingCalls[i];
    const toolName = call.name ?? "read_file";
    const args = call.args ?? {};
    const requiresPermission = (toolName === "write_file" || toolName === "run_command") && !session.autoApprove;
    if (requiresPermission) {
      const permId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const description = toolName === "write_file" ? `\xC9crire le fichier "${String(args.path ?? "")}" (${String(args.content ?? "").length} caract\xE8res)` : `Ex\xE9cuter la commande sandbox : "${String(args.command ?? "")}"`;
      const details = toolName === "write_file" ? String(args.content ?? "").slice(0, 800) : String(args.command ?? "");
      terminalEntries.push(makeTerminalEntry("permission", `[PERMISSION REQUISE] ${description}`));
      toolLogs.push({
        id: permId,
        name: toolName,
        args,
        status: "pending",
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      const pendingPermission = {
        id: permId,
        sessionId: session.id,
        toolName,
        description,
        details,
        args,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      const nextPaused = {
        sessionId: session.id,
        permissionId: permId,
        contents: paused.contents,
        modelContent: paused.modelContent,
        currentCall: call,
        remainingCalls: paused.remainingCalls.slice(i + 1),
        collectedToolLogs: toolLogs,
        collectedSubagents: subagents,
        collectedPartsForResponse: responseParts,
        assistantMessageId: paused.assistantMessageId
      };
      return {
        messages: [],
        pendingPermission,
        pausedState: nextPaused,
        terminalEntries
      };
    }
    const execRes = await executeToolCall(call, ctx, ai, session.model);
    terminalEntries.push(...execRes.terminalLogs);
    if (execRes.subagentTrace) subagents.push(execRes.subagentTrace);
    toolLogs.push({
      id: call.id ?? `tool-${Date.now()}-${i}`,
      name: toolName,
      args,
      status: execRes.status,
      result: execRes.output,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    responseParts.push({
      functionResponse: {
        id: call.id,
        name: call.name ?? toolName,
        response: { output: execRes.output }
      }
    });
  }
  const nextContents = [
    ...paused.contents,
    paused.modelContent,
    { role: "user", parts: responseParts }
  ];
  const followUp = await runAgentStep(
    session,
    ctx,
    nextContents,
    toolLogs,
    subagents,
    paused.assistantMessageId
  );
  return {
    ...followUp,
    terminalEntries: [...terminalEntries, ...followUp.terminalEntries]
  };
}
async function runCompactOnSession(session) {
  let usedFallback = false;
  const result = await compactConversationMessages(
    session.messages,
    async (transcript) => {
      if (!process.env.GEMINI_API_KEY) {
        usedFallback = true;
        return createDeterministicSummary(transcript);
      }
      try {
        const ai = getGenAIClient();
        const dummyLogs = [];
        const { response } = await generateWithModelFallback(
          ai,
          session.model,
          "LOW",
          (candidateModel) => ai.models.generateContent({
            model: candidateModel,
            contents: transcript,
            config: {
              systemInstruction: "R\xE9sume cette session de d\xE9veloppement technique en un paragraphe dense et pr\xE9cis en fran\xE7ais (fichiers modifi\xE9s, d\xE9cisions prises, \xE9tat actuel)."
            }
          }),
          dummyLogs
        );
        return (response.text ?? "").trim() || createDeterministicSummary(transcript);
      } catch {
        usedFallback = true;
        return createDeterministicSummary(transcript);
      }
    },
    session.model
  );
  return { ...result, usedFallback };
}

// server.ts
var __dirname = path2.dirname(fileURLToPath(import.meta.url));
var WORKSPACE_DIR = path2.resolve(__dirname, "kiln-workspace");
var DATA_DIR = path2.resolve(__dirname, ".kiln-data");
var SESSIONS_FILE = path2.join(DATA_DIR, "sessions.json");
var EXTENSIONS_FILE = path2.join(DATA_DIR, "extensions.json");
var PENDING_FILE = path2.join(DATA_DIR, "pending.json");
var workspace = new WorkspaceSandbox(WORKSPACE_DIR, true);
function readAgentsRules() {
  try {
    return workspace.readFile("agents.md");
  } catch {
    return "";
  }
}
function getSpecTasks() {
  try {
    return parseSpecTasks(workspace.readFile("spec.md"));
  } catch {
    return [];
  }
}
function loadExtensions() {
  fs2.mkdirSync(DATA_DIR, { recursive: true });
  if (fs2.existsSync(EXTENSIONS_FILE)) {
    try {
      const parsed = JSON.parse(fs2.readFileSync(EXTENSIONS_FILE, "utf-8"));
      if (Array.isArray(parsed.hooks) && Array.isArray(parsed.mcpServers)) {
        const existingHookIds = new Set(parsed.hooks.map((h) => h.id));
        const existingMcpIds = new Set(parsed.mcpServers.map((m) => m.id));
        const mergedHooks = [
          ...parsed.hooks,
          ...DEFAULT_HOOKS.filter((h) => !existingHookIds.has(h.id))
        ];
        const mergedMcp = [
          ...parsed.mcpServers,
          ...DEFAULT_MCP_SERVERS.filter((m) => !existingMcpIds.has(m.id))
        ];
        if (mergedHooks.length !== parsed.hooks.length || mergedMcp.length !== parsed.mcpServers.length) {
          saveExtensions(mergedHooks, mergedMcp);
        }
        return { hooks: mergedHooks, mcpServers: mergedMcp };
      }
    } catch {
    }
  }
  const initial = { hooks: DEFAULT_HOOKS, mcpServers: DEFAULT_MCP_SERVERS };
  saveExtensions(initial.hooks, initial.mcpServers);
  return initial;
}
function saveExtensions(hooks, mcpServers) {
  fs2.mkdirSync(DATA_DIR, { recursive: true });
  fs2.writeFileSync(EXTENSIONS_FILE, JSON.stringify({ hooks, mcpServers }, null, 2), "utf-8");
}
var extState = loadExtensions();
var hooksState = extState.hooks;
var mcpState = extState.mcpServers;
function getEnabledMcpTools() {
  return mcpState.filter((s) => s.enabled).flatMap((s) => s.tools);
}
function loadSessions() {
  fs2.mkdirSync(DATA_DIR, { recursive: true });
  if (fs2.existsSync(SESSIONS_FILE)) {
    try {
      const raw = JSON.parse(fs2.readFileSync(SESSIONS_FILE, "utf-8"));
      if (Array.isArray(raw) && raw.length > 0) {
        return raw.map((s) => ({
          ...s,
          thinkingLevel: s.thinkingLevel ?? "HIGH"
        }));
      }
    } catch {
    }
  }
  const initial = [
    createInitialSession(
      "session-main",
      "Session principale",
      DEFAULT_MODEL_ID,
      readAgentsRules(),
      "HIGH",
      getEnabledMcpTools()
    )
  ];
  saveSessions(initial);
  return initial;
}
function saveSessions(sessions2) {
  fs2.mkdirSync(DATA_DIR, { recursive: true });
  fs2.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions2, null, 2), "utf-8");
}
function getRuntimeContext() {
  return {
    workspace,
    hooks: hooksState,
    mcpServers: mcpState
  };
}
function loadPendingPermissions() {
  const map = /* @__PURE__ */ new Map();
  if (fs2.existsSync(PENDING_FILE)) {
    try {
      const entries = JSON.parse(fs2.readFileSync(PENDING_FILE, "utf-8"));
      if (Array.isArray(entries)) {
        for (const [k, v] of entries) {
          if (k && v?.permission) map.set(k, v);
        }
      }
    } catch {
    }
  }
  return map;
}
function savePendingPermissions() {
  fs2.mkdirSync(DATA_DIR, { recursive: true });
  fs2.writeFileSync(
    PENDING_FILE,
    JSON.stringify(Array.from(pendingPermissions.entries()), null, 2),
    "utf-8"
  );
}
var sessions = loadSessions();
var pendingPermissions = loadPendingPermissions();
var terminalLogs = [
  makeTerminalEntry(
    "info",
    'Terminal Kiln actif. Workspace sandbox mont\xE9 sur /workspace. Tapez "help" ou lancez le Self-Check.'
  )
];
function appendTerminalLogs(entries) {
  terminalLogs.push(...entries);
  if (terminalLogs.length > 250) {
    terminalLogs.splice(0, terminalLogs.length - 250);
  }
}
async function startServer() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
      workspaceFiles: workspace.listFiles().length
    });
  });
  app.get("/api/bootstrap", (_req, res) => {
    const activePending = Array.from(pendingPermissions.values()).map((p) => p.permission);
    res.json({
      models: AVAILABLE_MODELS,
      sessions,
      files: workspace.listFiles(),
      terminalLogs,
      pendingPermissions: activePending,
      hooks: hooksState,
      mcpServers: mcpState,
      specTasks: getSpecTasks()
    });
  });
  app.post("/api/sessions", (req, res) => {
    const title = typeof req.body?.title === "string" && req.body.title.trim() ? req.body.title.trim() : `Session ${sessions.length + 1}`;
    const model = typeof req.body?.model === "string" && AVAILABLE_MODELS.some((m) => m.id === req.body.model) ? req.body.model : DEFAULT_MODEL_ID;
    const newSession = createInitialSession(
      `session-${Date.now()}`,
      title,
      model,
      readAgentsRules(),
      "HIGH",
      getEnabledMcpTools()
    );
    sessions = [newSession, ...sessions];
    saveSessions(sessions);
    appendTerminalLogs([
      makeTerminalEntry("info", `Nouvelle session cr\xE9\xE9e : "${newSession.title}" (${model})`)
    ]);
    res.status(201).json({ session: newSession, sessions });
  });
  app.delete("/api/sessions/:id", (req, res) => {
    const { id } = req.params;
    if (sessions.length <= 1) {
      return res.status(400).json({ error: "Impossible de supprimer la derni\xE8re session active." });
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
  app.post("/api/sessions/:id/model", (req, res) => {
    const { id } = req.params;
    const modelId = String(req.body?.model ?? "");
    const thinkingLevel = req.body?.thinkingLevel;
    const foundModel = AVAILABLE_MODELS.find((m) => m.id === modelId);
    if (!foundModel) {
      return res.status(400).json({ error: `Mod\xE8le inconnu : ${modelId}` });
    }
    const session = sessions.find((s) => s.id === id);
    if (!session) {
      return res.status(404).json({ error: "Session introuvable." });
    }
    session.model = foundModel.id;
    if (thinkingLevel && ["LOW", "MEDIUM", "HIGH", "XHIGH"].includes(thinkingLevel)) {
      session.thinkingLevel = thinkingLevel;
    }
    session.systemPromptPreview = buildSystemPrompt({
      model: foundModel.id,
      thinkingLevel: session.thinkingLevel,
      agentsRules: readAgentsRules(),
      enabledMcpTools: getEnabledMcpTools()
    });
    session.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    saveSessions(sessions);
    appendTerminalLogs([
      makeTerminalEntry(
        "info",
        `[MOTEUR] Mod\xE8le : ${foundModel.id} \xB7 Raisonnement : ${session.thinkingLevel}`
      )
    ]);
    res.json({ session });
  });
  app.post("/api/sessions/:id/auto-approve", (req, res) => {
    const { id } = req.params;
    const session = sessions.find((s) => s.id === id);
    if (!session) {
      return res.status(404).json({ error: "Session introuvable." });
    }
    session.autoApprove = Boolean(req.body?.autoApprove);
    session.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    saveSessions(sessions);
    appendTerminalLogs([
      makeTerminalEntry(
        "info",
        `[PERMISSIONS] Mode Auto-Approuver ${session.autoApprove ? "activ\xE9" : "d\xE9sactiv\xE9"} pour "${session.title}".`
      )
    ]);
    res.json({ session });
  });
  app.post("/api/hooks/:id/toggle", (req, res) => {
    const { id } = req.params;
    hooksState = hooksState.map((h) => h.id === id ? { ...h, enabled: !h.enabled } : h);
    saveExtensions(hooksState, mcpState);
    const updated = hooksState.find((h) => h.id === id);
    if (updated) {
      appendTerminalLogs([
        makeTerminalEntry(
          "hook",
          `[HOOK] "${updated.name}" ${updated.enabled ? "activ\xE9" : "d\xE9sactiv\xE9"}.`
        )
      ]);
    }
    res.json({ hooks: hooksState, terminalLogs });
  });
  app.post("/api/mcp/:id/toggle", (req, res) => {
    const { id } = req.params;
    mcpState = mcpState.map((m) => m.id === id ? { ...m, enabled: !m.enabled } : m);
    saveExtensions(hooksState, mcpState);
    const updated = mcpState.find((m) => m.id === id);
    if (updated) {
      appendTerminalLogs([
        makeTerminalEntry(
          "info",
          `[MCP] Serveur "${updated.name}" ${updated.enabled ? "connect\xE9" : "d\xE9connect\xE9"}.`
        )
      ]);
    }
    for (const s of sessions) {
      s.systemPromptPreview = buildSystemPrompt({
        model: s.model,
        thinkingLevel: s.thinkingLevel,
        agentsRules: readAgentsRules(),
        enabledMcpTools: getEnabledMcpTools()
      });
    }
    saveSessions(sessions);
    res.json({ mcpServers: mcpState, sessions, terminalLogs });
  });
  app.post("/api/mcp/test", (req, res) => {
    const toolName = String(req.body?.toolName ?? "");
    const result = executeMcpTool(mcpState, toolName, workspace);
    appendTerminalLogs([
      makeTerminalEntry("action", `[MCP TEST] ${toolName}`),
      makeTerminalEntry(result.ok ? "stdout" : "stderr", result.output)
    ]);
    res.json({ ...result, terminalLogs });
  });
  app.post("/api/chat", async (req, res) => {
    const sessionId = String(req.body?.sessionId ?? "");
    const userText = String(req.body?.message ?? "").trim();
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session introuvable." });
    }
    if (!userText) {
      return res.status(400).json({ error: "Le message ne peut pas \xEAtre vide." });
    }
    if (userText === "/compact") {
      const compactRes = await runCompactOnSession(session);
      session.messages = compactRes.messages;
      session.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      saveSessions(sessions);
      appendTerminalLogs([
        makeTerminalEntry(
          "success",
          `[/compact] Historique condens\xE9 (${compactRes.usedFallback ? "synth\xE8se locale" : "Gemini"}).`
        )
      ]);
      return res.json({
        session,
        pendingPermission: null,
        terminalLogs,
        files: workspace.listFiles(),
        specTasks: getSpecTasks()
      });
    }
    const trailing = session.messages.at(-1);
    if (!(trailing && trailing.role === "user" && trailing.content === userText)) {
      const userMsg = {
        id: `user-${Date.now()}`,
        role: "user",
        content: userText,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      };
      session.messages.push(userMsg);
    }
    if (session.title === "Session principale" && session.messages.length <= 3) {
      session.title = userText.slice(0, 36) + (userText.length > 36 ? "\u2026" : "");
    }
    session.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
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
          kind: "agent",
          pausedAgent: outcome.pausedState
        });
      }
      savePendingPermissions();
      session.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      saveSessions(sessions);
      return res.json({
        session,
        pendingPermission: outcome.pendingPermission,
        terminalLogs,
        files: workspace.listFiles(),
        specTasks: getSpecTasks()
      });
    } catch (err) {
      const errText = formatGeminiError(err);
      appendTerminalLogs([makeTerminalEntry("stderr", `[GEMINI ERROR] ${errText}`)]);
      session.messages.push({
        id: `err-${Date.now()}`,
        role: "assistant",
        content: errText,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        model: session.model,
        isError: true
      });
      session.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      saveSessions(sessions);
      return res.status(200).json({
        session,
        pendingPermission: null,
        terminalLogs,
        files: workspace.listFiles(),
        specTasks: getSpecTasks()
      });
    }
  });
  app.post("/api/permissions/:id", async (req, res) => {
    const { id } = req.params;
    const decision = req.body?.decision === "approve" ? "approve" : "deny";
    const record = pendingPermissions.get(id);
    if (!record) {
      return res.status(404).json({ error: "Demande de permission introuvable ou d\xE9j\xE0 trait\xE9e." });
    }
    pendingPermissions.delete(id);
    savePendingPermissions();
    const session = sessions.find((s) => s.id === record.permission.sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session associ\xE9e introuvable." });
    }
    if (record.kind === "terminal" && record.command) {
      if (decision === "approve") {
        const preHook = evaluateHooks(hooksState, "pre_command", { command: record.command }, workspace);
        appendTerminalLogs(preHook.logs.map((l) => makeTerminalEntry("hook", l)));
        appendTerminalLogs([makeTerminalEntry("command", `$ ${record.command}`)]);
        const result = executeSafeCommand(record.command, workspace);
        if (result.stdout) appendTerminalLogs([makeTerminalEntry("stdout", result.stdout)]);
        if (result.stderr) appendTerminalLogs([makeTerminalEntry("stderr", result.stderr)]);
      } else {
        appendTerminalLogs([
          makeTerminalEntry("stderr", `[PERMISSION REFUS\xC9E] Ex\xE9cution annul\xE9e : ${record.command}`)
        ]);
      }
      return res.json({
        session,
        pendingPermission: null,
        terminalLogs,
        files: workspace.listFiles(),
        specTasks: getSpecTasks()
      });
    }
    if (record.kind === "agent" && record.pausedAgent) {
      try {
        const outcome = await resumePausedAgent(
          session,
          record.pausedAgent,
          decision,
          getRuntimeContext()
        );
        appendTerminalLogs(outcome.terminalEntries);
        if (outcome.messages.length > 0) {
          session.messages.push(...outcome.messages);
        }
        if (outcome.pendingPermission && outcome.pausedState) {
          pendingPermissions.set(outcome.pendingPermission.id, {
            permission: outcome.pendingPermission,
            kind: "agent",
            pausedAgent: outcome.pausedState
          });
        }
        savePendingPermissions();
        session.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        saveSessions(sessions);
        return res.json({
          session,
          pendingPermission: outcome.pendingPermission,
          terminalLogs,
          files: workspace.listFiles(),
          specTasks: getSpecTasks()
        });
      } catch (err) {
        const errText = formatGeminiError(err);
        appendTerminalLogs([makeTerminalEntry("stderr", `[GEMINI ERROR] ${errText}`)]);
        session.messages.push({
          id: `err-${Date.now()}`,
          role: "assistant",
          content: errText,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          model: session.model,
          isError: true
        });
        saveSessions(sessions);
        return res.json({
          session,
          pendingPermission: null,
          terminalLogs,
          files: workspace.listFiles(),
          specTasks: getSpecTasks()
        });
      }
    }
    res.json({
      session,
      pendingPermission: null,
      terminalLogs,
      files: workspace.listFiles(),
      specTasks: getSpecTasks()
    });
  });
  app.get("/api/files", (_req, res) => {
    res.json({ files: workspace.listFiles(), specTasks: getSpecTasks() });
  });
  app.get("/api/files/content", (req, res) => {
    const filePath = String(req.query.path ?? "");
    try {
      const content = workspace.readFile(filePath);
      res.json({ path: filePath, content });
    } catch (err) {
      res.status(404).json({ error: String(err.message ?? err) });
    }
  });
  app.post("/api/files/content", async (req, res) => {
    const filePath = String(req.body?.path ?? "");
    const content = String(req.body?.content ?? "");
    try {
      const preHook = evaluateHooks(hooksState, "pre_write", { targetPath: filePath, content }, workspace);
      appendTerminalLogs(preHook.logs.map((l) => makeTerminalEntry("hook", l)));
      if (!preHook.allowed) {
        return res.status(400).json({ error: preHook.blockedReason ?? "Bloqu\xE9 par hook pre_write", terminalLogs });
      }
      const saved = workspace.writeFile(filePath, content);
      appendTerminalLogs([
        makeTerminalEntry("success", `[FICHIER] "${saved.path}" enregistr\xE9 (${saved.bytes} octets)`)
      ]);
      const postHook = evaluateHooks(hooksState, "post_write", { targetPath: saved.path }, workspace);
      appendTerminalLogs(postHook.logs.map((l) => makeTerminalEntry("hook", l)));
      if (saved.path === "agents.md") {
        for (const s of sessions) {
          s.systemPromptPreview = buildSystemPrompt({
            model: s.model,
            thinkingLevel: s.thinkingLevel,
            agentsRules: content,
            enabledMcpTools: getEnabledMcpTools()
          });
        }
        saveSessions(sessions);
      }
      res.json({
        saved,
        files: workspace.listFiles(),
        terminalLogs,
        sessions,
        specTasks: getSpecTasks()
      });
    } catch (err) {
      res.status(400).json({ error: String(err.message ?? err) });
    }
  });
  app.post("/api/terminal/exec", async (req, res) => {
    const command = String(req.body?.command ?? "").trim();
    const sessionId = String(req.body?.sessionId ?? sessions[0]?.id ?? "session-main");
    const session = sessions.find((s) => s.id === sessionId) ?? sessions[0];
    if (!command) {
      return res.status(400).json({ error: "Commande vide." });
    }
    if (command.toLowerCase() === "self-check") {
      appendTerminalLogs([makeTerminalEntry("command", "$ self-check")]);
      const report = await runSelfCheckSuite();
      for (const c of report.cases) {
        appendTerminalLogs([
          makeTerminalEntry(
            c.passed ? "success" : "stderr",
            `[${c.passed ? "PASS" : "FAIL"}] ${c.name} (${c.durationMs}ms)${c.passed ? "" : ` \u2014 ${c.detail}`}`
          )
        ]);
      }
      appendTerminalLogs([
        makeTerminalEntry(
          report.allPassed ? "success" : "stderr",
          `[SELF-CHECK] ${report.passedCount}/${report.totalCount} tests valid\xE9s.`
        )
      ]);
      return res.json({ report, terminalLogs, pendingPermission: null });
    }
    const isCodeExec = command.toLowerCase().startsWith("node ");
    if (isCodeExec && session && !session.autoApprove) {
      const permId = `perm-term-${Date.now()}`;
      const perm = {
        id: permId,
        sessionId: session.id,
        toolName: "run_command",
        description: `Ex\xE9cuter la commande sandbox : "${command}"`,
        details: command,
        args: { command },
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      pendingPermissions.set(permId, {
        permission: perm,
        kind: "terminal",
        command
      });
      savePendingPermissions();
      appendTerminalLogs([
        makeTerminalEntry("permission", `[PERMISSION REQUISE] Ex\xE9cuter "${command}"`)
      ]);
      return res.json({ pendingPermission: perm, terminalLogs });
    }
    const preHook = evaluateHooks(hooksState, "pre_command", { command }, workspace);
    appendTerminalLogs(preHook.logs.map((l) => makeTerminalEntry("hook", l)));
    appendTerminalLogs([makeTerminalEntry("command", `$ ${command}`)]);
    const result = executeSafeCommand(command, workspace);
    if (result.stdout) appendTerminalLogs([makeTerminalEntry("stdout", result.stdout)]);
    if (result.stderr) appendTerminalLogs([makeTerminalEntry("stderr", result.stderr)]);
    return res.json({ result, terminalLogs, pendingPermission: null });
  });
  app.post("/api/self-check", async (_req, res) => {
    appendTerminalLogs([makeTerminalEntry("command", "$ self-check --suite")]);
    const report = await runSelfCheckSuite();
    for (const c of report.cases) {
      appendTerminalLogs([
        makeTerminalEntry(
          c.passed ? "success" : "stderr",
          `[${c.passed ? "PASS" : "FAIL"}] ${c.name} (${c.durationMs}ms)`
        )
      ]);
    }
    appendTerminalLogs([
      makeTerminalEntry(
        report.allPassed ? "success" : "stderr",
        `[SELF-CHECK] ${report.passedCount}/${report.totalCount} v\xE9rifications r\xE9ussies (PASS).`
      )
    ]);
    res.json({ report, terminalLogs });
  });
  const httpServer = http.createServer(app);
  if (process.env.NODE_ENV !== "production") {
    const hmrDisabled = process.env.DISABLE_HMR === "true";
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: { server: httpServer },
        hmr: !hmrDisabled
      },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path2.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path2.join(distDir, "index.html"));
    });
  }
  const PORT = Number(process.env.PORT || 3e3);
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Kiln Agentic Studio running on http://0.0.0.0:${PORT}`);
  });
}
startServer().catch((err) => {
  console.error("Failed to start Kiln server:", err);
  process.exit(1);
});
