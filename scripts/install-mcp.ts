#!/usr/bin/env bun

/**
 * Claude Code settings.json 자동 패치
 *
 * 사용법:
 *   jarvis install-mcp             — 실제 적용 (백업 파일 생성)
 *   jarvis install-mcp --dry-run   — 변경사항 미리보기만
 */

import { join } from "node:path";
import {
  loadClaudeSettings,
  patchClaudeSettings,
  PATHS,
} from "./lib/config.js";

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const HOME = process.env.HOME ?? "~";
const JARVIS_HOME = join(HOME, "jarvis");

const JARVIS_MCP_SERVERS = {
  "jarvis-memory": {
    command: "bun",
    args: ["run", `${JARVIS_HOME}/packages/memory-server/src/index.ts`],
  },
  "jarvis-gateway": {
    command: "bun",
    args: ["run", `${JARVIS_HOME}/packages/gateway-server/src/index.ts`],
  },
};

const JARVIS_PERMISSIONS = [
  "mcp__jarvis-memory__jarvis_memory_save",
  "mcp__jarvis-memory__jarvis_memory_recall",
  "mcp__jarvis-memory__jarvis_memory_list",
  "mcp__jarvis-memory__jarvis_session_save",
  "mcp__jarvis-memory__jarvis_session_search",
  "mcp__jarvis-memory__jarvis_memory_dream",
  "mcp__jarvis-memory__jarvis_dream_history",
  "mcp__jarvis-memory__jarvis_user_profile",
  "mcp__jarvis-memory__jarvis_memory_stats",
  "mcp__jarvis-memory__jarvis_sync_skills",
  "mcp__jarvis-memory__jarvis_sync_sessions",
  "mcp__jarvis-gateway__jarvis_gateway_route",
  "mcp__jarvis-gateway__jarvis_gateway_send",
  "mcp__jarvis-gateway__jarvis_gateway_pair",
  "mcp__jarvis-gateway__jarvis_profile_manage",
  "mcp__jarvis-gateway__jarvis_cron_manage",
  "mcp__jarvis-gateway__jarvis_sandbox_config",
  "mcp__jarvis-gateway__jarvis_gateway_status",
  "mcp__jarvis-gateway__jarvis_worktree_manage",
];

const JARVIS_HOOKS = [
  {
    matcher: "Edit|Write|MultiEdit|Bash|Agent",
    hooks: [
      {
        type: "command",
        command: `node "${JARVIS_HOME}/hooks/auto-memory.js"`,
        timeout: 5,
      },
      {
        type: "command",
        command: `node "${JARVIS_HOME}/hooks/skill-nudge.js"`,
        timeout: 5,
      },
    ],
  },
];

// UserPromptSubmit 훅 — IntentGate 자동 발동
const JARVIS_USER_PROMPT_HOOKS = [
  {
    hooks: [
      {
        type: "command",
        command: `bun run "${JARVIS_HOME}/hooks/intent-gate.js"`,
        timeout: 3,
      },
    ],
  },
];

function simulatePatch(): { added: string[]; preserved: string[] } {
  const current = loadClaudeSettings();
  const added: string[] = [];
  const preserved: string[] = [];

  for (const name of Object.keys(JARVIS_MCP_SERVERS)) {
    if (current.mcpServers?.[name]) preserved.push(`mcpServers.${name}`);
    else added.push(`mcpServers.${name}`);
  }

  const allowSet = new Set(current.permissions?.allow ?? []);
  for (const perm of JARVIS_PERMISSIONS) {
    if (allowSet.has(perm)) preserved.push(`permissions.allow[${perm}]`);
    else added.push(`permissions.allow[${perm}]`);
  }

  const existingHooks = current.hooks?.PostToolUse ?? [];
  for (const hook of JARVIS_HOOKS) {
    const matched = existingHooks.some((h) => JSON.stringify(h) === JSON.stringify(hook));
    if (matched) preserved.push(`hooks.PostToolUse[jarvis]`);
    else added.push(`hooks.PostToolUse[jarvis]`);
  }

  const existingUserPrompt = current.hooks?.UserPromptSubmit ?? [];
  for (const hook of JARVIS_USER_PROMPT_HOOKS) {
    const matched = existingUserPrompt.some(
      (h) => JSON.stringify(h) === JSON.stringify(hook),
    );
    if (matched) preserved.push(`hooks.UserPromptSubmit[intent-gate]`);
    else added.push(`hooks.UserPromptSubmit[intent-gate]`);
  }

  return { added, preserved };
}

function main(): void {
  const dryRun = process.argv.includes("--dry-run");

  console.log(`\n${GREEN}Claude Code settings.json 패치${RESET}`);
  console.log(`${DIM}파일: ${PATHS.claudeSettings}${RESET}\n`);

  const sim = simulatePatch();

  if (sim.added.length === 0) {
    console.log(`${GREEN}변경사항 없음 (이미 모두 등록되어 있습니다)${RESET}`);
    return;
  }

  console.log(`${YELLOW}추가될 항목 (${sim.added.length}):${RESET}`);
  for (const a of sim.added) console.log(`  + ${a}`);

  if (sim.preserved.length > 0) {
    console.log(`\n${DIM}이미 존재 (유지): ${sim.preserved.length}개${RESET}`);
  }

  if (dryRun) {
    console.log(`\n${DIM}(--dry-run: 실제 변경 안 함)${RESET}`);
    return;
  }

  const result = patchClaudeSettings({
    mcpServers: JARVIS_MCP_SERVERS,
    permissionsAllow: JARVIS_PERMISSIONS,
    postToolUseHooks: JARVIS_HOOKS,
    userPromptSubmitHooks: JARVIS_USER_PROMPT_HOOKS,
  });

  console.log(`\n${GREEN}패치 완료 (${result.changed.length}개 변경)${RESET}`);
  if (result.backup) {
    console.log(`${DIM}백업: ${result.backup}${RESET}`);
  }
  console.log(`${YELLOW}Claude Code를 재시작해야 MCP 서버가 로드됩니다.${RESET}`);
}

main();
