import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildSystemPrompt,
  compactConversationMessages,
  executeSafeCommand,
  extractRetryAfterMs,
  getModelFallbackChain,
  isRateLimitError,
  runSelfCheckSuite,
  SEEDED_WORKSPACE_FILES,
  withRetry429,
  WorkspaceSandbox,
} from './kilnEngine';
import {
  DEFAULT_HOOKS,
  DEFAULT_MCP_SERVERS,
  evaluateHooks,
  executeMcpTool,
  parseSpecTasks,
} from './kilnExtensions';
import type { ChatMessage } from '../shared/types';

test('buildSystemPrompt injects active model, thinkingLevel, OS, date, MCP tools, and agents.md rules', () => {
  const prompt = buildSystemPrompt({
    model: 'gemini-4-hydrogen',
    thinkingLevel: 'XHIGH',
    osInfo: 'Linux 6.8',
    date: '2026-11-15',
    agentsRules: 'Toujours vérifier avec self-check.',
    enabledMcpTools: ['mcp_spec_status', 'mcp_workspace_stats'],
  });
  assert.match(prompt, /gemini-4-hydrogen/);
  assert.match(prompt, /XHIGH/);
  assert.match(prompt, /Linux 6\.8/);
  assert.match(prompt, /2026-11-15/);
  assert.match(prompt, /mcp_spec_status/);
  assert.match(prompt, /Toujours vérifier avec self-check/);
});

test('WorkspaceSandbox isolates files and blocks path traversal', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kiln-test-'));
  try {
    const sandbox = new WorkspaceSandbox(tmp, true);
    const files = sandbox.listFiles().map((f) => f.path);
    assert.ok(files.includes('agents.md'));
    assert.ok(files.includes('features.md'));
    assert.ok(files.includes('spec.md'));

    sandbox.writeFile('src/sample.txt', 'hello kiln');
    assert.equal(sandbox.readFile('src/sample.txt'), 'hello kiln');

    assert.throws(() => sandbox.resolveSafePath('../../etc/passwd'), /Accès refusé/);
    assert.throws(() => sandbox.resolveSafePath('/etc/hosts'), /Accès refusé/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('withRetry429 retries HTTP 429 with exponential backoff and resolves on recovery', async () => {
  let attempts = 0;
  const recordedDelays: number[] = [];

  const result = await withRetry429(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        const err = new Error('RESOURCE_EXHAUSTED (429)');
        (err as { status?: number }).status = 429;
        throw err;
      }
      return 'recovered';
    },
    {
      maxRetries: 4,
      initialDelayMs: 25,
      sleep: async (ms) => {
        recordedDelays.push(ms);
      },
    },
  );

  assert.equal(result, 'recovered');
  assert.equal(attempts, 3);
  assert.deepEqual(recordedDelays, [25, 50]);
});

test('compactConversationMessages condenses long history into one synthesis message', async () => {
  const messages: ChatMessage[] = [
    { id: '1', role: 'user', content: 'Crée un fichier', timestamp: '2026-11-15T00:00:00Z' },
    { id: '2', role: 'assistant', content: 'Fichier créé', timestamp: '2026-11-15T00:00:01Z' },
    { id: '3', role: 'user', content: 'Ajoute des tests', timestamp: '2026-11-15T00:00:02Z' },
    { id: '4', role: 'assistant', content: 'Tests ajoutés', timestamp: '2026-11-15T00:00:03Z' },
  ];

  const res = await compactConversationMessages(
    messages,
    async () => 'Fichier créé et tests ajoutés.',
    'gemini-4-hydrogen',
  );

  assert.equal(res.compacted, true);
  assert.equal(res.messages.length, 1);
  assert.ok(res.messages[0].isCompactSummary);
  assert.match(res.messages[0].content, /Fichier créé et tests ajoutés\./);
});

test('evaluateHooks blocks plaintext API keys on pre_write and logs post_write audit', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kiln-hooks-'));
  try {
    const sandbox = new WorkspaceSandbox(tmp, false);
    const blocked = evaluateHooks(DEFAULT_HOOKS, 'pre_write', {
      targetPath: 'config.js',
      content: 'const API = "AIzaSyAbcdefGhijkLmnopQrstUvwxyz123456";',
    });
    assert.equal(blocked.allowed, false);
    assert.match(blocked.blockedReason ?? '', /secret/i);

    const safe = evaluateHooks(
      DEFAULT_HOOKS,
      'post_write',
      { targetPath: 'clean.js' },
      sandbox,
    );
    assert.equal(safe.allowed, true);
    assert.match(sandbox.readFile('hooks.log'), /clean\.js/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('executeMcpTool runs enabled MCP tools and blocks disabled MCP servers', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kiln-mcp-'));
  try {
    const sandbox = new WorkspaceSandbox(tmp, true);
    const res = executeMcpTool(DEFAULT_MCP_SERVERS, 'mcp_spec_status', sandbox);
    assert.equal(res.ok, true);
    assert.match(res.output, /totalTasks/);

    const disabled = DEFAULT_MCP_SERVERS.map((s) =>
      s.id === 'mcp-spec-tracker' ? { ...s, enabled: false } : s,
    );
    const blocked = executeMcpTool(disabled, 'mcp_spec_status', sandbox);
    assert.equal(blocked.ok, false);
    assert.match(blocked.output, /désactivé/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('parseSpecTasks parses completed and pending spec.md checkboxes', () => {
  const tasks = parseSpecTasks(SEEDED_WORKSPACE_FILES['spec.md']);
  assert.ok(tasks.length >= 6);
  assert.ok(tasks.some((t) => t.completed));
  assert.ok(tasks.some((t) => !t.completed));
});

test('executeSafeCommand lists files, executes sandboxed node, and blocks chained shell', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kiln-cmd-'));
  try {
    const sandbox = new WorkspaceSandbox(tmp, true);
    const lsRes = executeSafeCommand('ls', sandbox);
    assert.equal(lsRes.exitCode, 0);
    assert.match(lsRes.stdout, /agents\.md/);

    const nodeRes = executeSafeCommand('node hello.js', sandbox);
    assert.equal(nodeRes.exitCode, 0);
    assert.match(nodeRes.stdout, /Kiln Sandbox/);

    const blockedRes = executeSafeCommand('ls && rm -rf /', sandbox);
    assert.equal(blockedRes.exitCode, 1);
    assert.match(blockedRes.stderr, /non autorisés/);

    sandbox.writeFile(
      'esm-check.js',
      "import path from 'node:path';\nconsole.log('ESM_OK:' + path.basename('a/b.js'));\n",
    );
    const esmRes = executeSafeCommand('node esm-check.js', sandbox);
    assert.equal(esmRes.exitCode, 0);
    assert.match(esmRes.stdout, /ESM_OK:b\.js/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('runSelfCheckSuite passes all 12 checks', async () => {
  const report = await runSelfCheckSuite();
  assert.equal(report.totalCount, 12);
  assert.equal(report.passedCount, 12);
  assert.equal(report.allPassed, true);
});

test('getModelFallbackChain prioritizes free-tier alternatives and extractRetryAfterMs parses hints', () => {
  const chain = getModelFallbackChain('gemini-4-hydrogen');
  assert.deepEqual(chain, ['gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-2.5-flash']);

  const liteChain = getModelFallbackChain('gemini-3.1-flash-lite');
  assert.equal(liteChain[0], 'gemini-3.1-flash-lite');
  assert.ok(liteChain.includes('gemini-2.5-flash'));

  assert.equal(extractRetryAfterMs(new Error('Please retry in 2.5s')), 2500);
  assert.equal(extractRetryAfterMs(new Error('retryDelay: "12s"')), 8000);
  assert.equal(isRateLimitError({ status: 503, message: 'UNAVAILABLE' }), true);
});

test('executeMcpTool mcp_rea_analyze extracts ESM exports, functions, and spec progress', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kiln-rea-'));
  try {
    const sandbox = new WorkspaceSandbox(tmp, true);
    sandbox.writeFile(
      'sample.js',
      "export function ping() { return 'pong'; }\nexport const VERSION = '1.0.0';\n",
    );
    const reaRes = executeMcpTool(DEFAULT_MCP_SERVERS, 'mcp_rea_analyze', sandbox);
    assert.equal(reaRes.ok, true);
    const parsed = JSON.parse(reaRes.output) as {
      moduleCount: number;
      specProgress: { total: number };
      modules: Array<{ path: string; exports: string[]; moduleStyle: string }>;
    };
    assert.ok(parsed.moduleCount >= 5);
    assert.ok(parsed.specProgress.total >= 9);
    const sampleMod = parsed.modules.find((m) => m.path === 'sample.js');
    assert.ok(sampleMod);
    assert.equal(sampleMod.moduleStyle, 'esm');
    assert.ok(sampleMod.exports.includes('ping'));
    assert.ok(sampleMod.exports.includes('VERSION'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Chaos & Least-Privilege: sandboxed node strips GEMINI_API_KEY and blocks non-JS execution', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kiln-chaos-env-'));
  const previousApiKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'AIzaSyTestSecretShouldNeverLeak123456789';
  try {
    const sandbox = new WorkspaceSandbox(tmp, true);
    sandbox.writeFile(
      'env-probe.js',
      "console.log(process.env.GEMINI_API_KEY ? 'LEAKED' : 'MISSING');\n",
    );
    const probeRes = executeSafeCommand('node env-probe.js', sandbox);
    assert.equal(probeRes.exitCode, 0);
    assert.equal(probeRes.stdout.trim(), 'MISSING');

    const nonJsRes = executeSafeCommand('node spec.md', sandbox);
    assert.equal(nonJsRes.exitCode, 1);
    assert.match(nonJsRes.stderr, /\.js, \.mjs ou \.cjs/);
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = previousApiKey;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Chaos & Hooks: blocks .env, Bearer, and process.env writes while redacting secrets in hooks.log', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kiln-chaos-hooks-'));
  try {
    const sandbox = new WorkspaceSandbox(tmp, false);

    const envWrite = evaluateHooks(DEFAULT_HOOKS, 'pre_write', {
      targetPath: '.env.local',
      content: 'PORT=3000',
    });
    assert.equal(envWrite.allowed, false);
    assert.match(envWrite.blockedReason ?? '', /\.env\.local/i);

    const processEnvWrite = evaluateHooks(DEFAULT_HOOKS, 'pre_write', {
      targetPath: 'exfil.js',
      content: 'console.log(process.env.GEMINI_API_KEY);',
    });
    assert.equal(processEnvWrite.allowed, false);

    const bearerWrite = evaluateHooks(DEFAULT_HOOKS, 'pre_write', {
      targetPath: 'auth.js',
      content: 'const h = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9_payload";',
    });
    assert.equal(bearerWrite.allowed, false);

    const cmdAudit = evaluateHooks(
      DEFAULT_HOOKS,
      'pre_command',
      { command: 'echo Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9_payload\nNEXT_LINE' },
      sandbox,
    );
    assert.equal(cmdAudit.allowed, true);
    const logContent = sandbox.readFile('hooks.log');
    assert.match(logContent, /\[REDACTED\]/);
    assert.doesNotMatch(logContent, /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9_payload/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

