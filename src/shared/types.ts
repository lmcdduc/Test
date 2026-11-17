export type ThinkingLevelOption = 'LOW' | 'MEDIUM' | 'HIGH' | 'XHIGH';

export interface ModelOption {
  id: string;
  label: string;
  provider: string;
  tier: 'Gratuit' | 'Standard';
  description: string;
  supportsThinkingLevels?: ThinkingLevelOption[];
}

export interface ToolCallLog {
  id: string;
  name:
    | 'read_file'
    | 'write_file'
    | 'list_files'
    | 'run_command'
    | 'delegate_subagent'
    | 'mcp_call';
  args: Record<string, unknown>;
  status: 'pending' | 'approved' | 'denied' | 'executed' | 'error';
  result?: string;
  timestamp: string;
}

export interface SubagentTrace {
  id: string;
  role: string;
  task: string;
  summary: string;
  model: string;
  durationMs: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  model?: string;
  toolCalls?: ToolCallLog[];
  subagents?: SubagentTrace[];
  isCompactSummary?: boolean;
  isError?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  model: string;
  thinkingLevel: ThinkingLevelOption;
  autoApprove: boolean;
  messages: ChatMessage[];
  systemPromptPreview: string;
  createdAt: string;
  updatedAt: string;
}

export interface PendingPermission {
  id: string;
  sessionId: string;
  toolName: 'write_file' | 'run_command';
  description: string;
  details: string;
  args: Record<string, unknown>;
  createdAt: string;
}

export interface WorkspaceFileEntry {
  path: string;
  size: number;
  updatedAt: string;
}

export interface TerminalEntry {
  id: string;
  timestamp: string;
  type: 'info' | 'command' | 'stdout' | 'stderr' | 'permission' | 'success' | 'action' | 'hook';
  text: string;
}

export interface SelfCheckCase {
  id: string;
  name: string;
  category: string;
  passed: boolean;
  detail: string;
  durationMs: number;
}

export interface SelfCheckReport {
  ranAt: string;
  passedCount: number;
  totalCount: number;
  allPassed: boolean;
  cases: SelfCheckCase[];
}

export type HookEvent = 'pre_write' | 'post_write' | 'pre_command' | 'post_command';
export type HookActionType = 'log_audit' | 'block_secrets' | 'run_self_check';

export interface HookRule {
  id: string;
  name: string;
  event: HookEvent;
  action: HookActionType;
  enabled: boolean;
  description: string;
}

export interface McpServerConfig {
  id: string;
  name: string;
  transport: 'sandbox' | 'http';
  description: string;
  enabled: boolean;
  tools: string[];
  endpoint?: string;
}

export interface SpecTaskItem {
  id: string;
  phase: string;
  title: string;
  completed: boolean;
  rawLine: string;
}
