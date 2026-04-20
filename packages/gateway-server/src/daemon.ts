#!/usr/bin/env bun

/**
 * Jarvis Daemon — 백그라운드 상시 대기 프로세스
 *
 * 채널(Telegram/Discord/Slack)에서 메시지를 수신하고,
 * 인증/권한 체크 후 claude CLI를 호출하여 응답을 반환합니다.
 *
 * 실행: bun run ~/jarvis/packages/gateway-server/src/daemon.ts
 * 관리: ~/jarvis/jarvis.sh start|stop|status|logs
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { routeMessage, type IncomingMessage } from "./router.js";
import { buildClaudeArgs, buildPersonalityPrompt } from "./permissions.js";
import {
  loadUserConfig,
  getOrCreateClaudeSessionId,
  markClaudeSessionStarted,
} from "./auth.js";
import { addCronJob, listCronJobs, deleteCronJob, toggleCronJob } from "./cron.js";
// worktree는 workflow.ts가 관리 (router → workflow → worktree)

// --- 설정 ---
const JARVIS_DIR = join(process.env.HOME ?? "~", ".jarvis");
const LOG_FILE = join(JARVIS_DIR, "daemon.log");
const PID_FILE = join(JARVIS_DIR, "daemon.pid");
const CONFIG_FILE = join(process.env.HOME ?? "~", "jarvis", ".env");
const PROJECT_DIR = process.env.JARVIS_PROJECT_DIR ?? ""; // 프로젝트 디렉토리 (설정 시 worktree 활성화)
const SANDBOX_ROOT = join(JARVIS_DIR, "sandboxes"); // 유저별 cwd 샌드박스 (~/.jarvis/sandboxes/)

/**
 * 유저별 빈 샌드박스 디렉토리를 보장하고 절대 경로를 반환합니다.
 *
 * 목적: claude 자식 프로세스의 cwd를 빈 디렉토리로 강제해서
 *       Read 도구가 상대 경로/cwd 하위 탐색으로 홈/시스템 파일에 접근하지 못하게 함.
 *       --add-dir로 명시적으로 화이트리스트된 디렉토리만 접근 가능.
 *
 * - userId의 위험 문자(/, :, .., 등)는 _ 로 sanitize
 * - 디렉토리는 비어 있어야 함 (절대 다른 파일 두지 말 것)
 * - 위치: ~/.jarvis/sandboxes/{safe-id}/
 */
function ensureSandbox(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_") || "anonymous";
  const dir = join(SANDBOX_ROOT, safe);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// --- 로깅 ---
function log(level: string, message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}`;

  try {
    if (!existsSync(JARVIS_DIR)) mkdirSync(JARVIS_DIR, { recursive: true });
    appendFileSync(LOG_FILE, line + "\n");
  } catch {
    // 파일 쓰기 실패 시에만 stderr로 폴백
    console.error(line);
  }
}

// --- .env 로드 ---
function loadEnv(): void {
  if (!existsSync(CONFIG_FILE)) return;
  try {
    const content = readFileSync(CONFIG_FILE, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env 로드 실패 무시
  }
}

// --- Claude CLI 실행 ---
async function executeWithClaude(
  prompt: string,
  profileName: string,
  userId: string,
  personality?: Record<string, unknown>,
  userName?: string,
  workDir?: string,
): Promise<string> {

  const personalityPrompt = buildPersonalityPrompt(
    personality ?? {},
    userName,
    "external-channel",
    userId,
  );

  const args = buildClaudeArgs(profileName, prompt, {
    systemPrompt: personalityPrompt,
    projectDir: workDir,
  });

  // 대화 컨텍스트 격리:
  //   user_id별로 영속적인 UUID를 1:1 매핑
  //   첫 호출: --session-id <UUID> (새 세션 생성)
  //   이후:   --resume <UUID>    (기존 세션 이어가기)
  //   /clear: UUID 리셋 → 다음 호출이 다시 --session-id로 시작
  const sessionHandle = getOrCreateClaudeSessionId(userId);
  if (sessionHandle.started) {
    args.push("--resume", sessionHandle.session_id);
  } else {
    args.push("--session-id", sessionHandle.session_id);
  }

  const sessionMode = sessionHandle.started ? "resume" : "new";
  log(
    "INFO",
    `claude 실행: profile=${profileName}, session=${sessionHandle.session_id.slice(0, 8)}... (${sessionMode}), dir=${workDir ?? "sandbox"}, prompt=${prompt.slice(0, 80)}...`,
  );

  return new Promise((resolve) => {
    // 사용자별 메모리 격리 핵심:
    // 환경변수로 user_id를 주입하면 claude 자식 → MCP 서버 → IntentGate 훅까지
    // 모두 이 환경변수를 상속받아 자동으로 올바른 유저 컨텍스트로 동작합니다.
    // (LLM 자율성 의존 X, OS 프로세스 환경변수로 100% 보장)
    const channelName = userId.includes(":") ? userId.split(":")[0] : "owner";

    // cwd 샌드박스 강제 — 핵심 격리 장치
    // workDir(예: /dev worktree)이 명시되면 그쪽, 아니면 유저별 빈 샌드박스
    // → Read의 기본 cwd가 빈 디렉토리이므로 홈/시스템 파일 자동 접근 차단
    // → 접근 가능한 디렉토리는 오로지 buildClaudeArgs가 --add-dir로 명시한 것뿐
    const cwdDir = workDir ?? ensureSandbox(userId);
    log("INFO", `cwd 샌드박스: ${cwdDir}`);

    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: cwdDir,
      timeout: 5 * 60 * 1000,
      env: {
        ...process.env,
        JARVIS_USER_ID: userId,
        JARVIS_USER_NAME: userName ?? "",
        JARVIS_CHANNEL: channelName,
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        log("ERROR", `claude 종료 코드=${code}, stderr=${stderr.slice(0, 200)}`);
        resolve(`오류가 발생했습니다. (코드: ${code})`);
      } else {
        // 정상 종료 → 세션이 실제로 생성됨(또는 재사용됨)
        // 첫 호출이었다면 이 시점부터 started=true로 전환 (다음 호출은 --resume)
        if (!sessionHandle.started) {
          markClaudeSessionStarted(userId);
        }
        log("INFO", `claude 완료: ${stdout.length}자 응답`);
        resolve(stdout.trim() || "응답이 비어있습니다.");
      }
    });

    child.on("error", (err) => {
      log("ERROR", `claude 실행 실패: ${err.message}`);
      resolve(`실행 실패: ${err.message}`);
    });
  });
}

// --- 크론잡 커맨드 처리 ---
function handleCronCommand(
  userId: string,
  action: string,
  args: Record<string, string>,
): string {
  switch (action) {
    case "cron_add": {
      const result = addCronJob(userId, args.prompt ?? "");
      if (!result.success) return `크론잡 오류: ${result.error}`;
      const job = result.job!;
      return `크론잡 등록 완료:\n  ID: ${job.id}\n  스케줄: ${job.schedule}\n  작업: ${job.prompt}`;
    }
    case "cron_list": {
      const jobs = listCronJobs(userId);
      if (jobs.length === 0) return "등록된 크론잡이 없습니다.";
      return "등록된 크론잡:\n" +
        jobs.map((j) => `  [${j.enabled ? "활성" : "중지"}] ${j.id}: ${j.schedule} → ${j.prompt}`).join("\n");
    }
    case "cron_delete": {
      const ok = deleteCronJob(userId, args.job_id ?? "");
      return ok ? "크론잡이 삭제되었습니다." : "크론잡을 찾을 수 없습니다.";
    }
    case "cron_pause": {
      const result = toggleCronJob(userId, args.job_id ?? "");
      if (!result.success) return "크론잡을 찾을 수 없습니다.";
      return `크론잡 ${result.enabled ? "재개" : "일시 중지"}됨`;
    }
    default:
      return "알 수 없는 크론잡 명령입니다.";
  }
}

// --- 메시지 처리 파이프라인 ---
async function handleMessage(incoming: IncomingMessage): Promise<string> {
  log("INFO", `수신: [${incoming.channel}] ${incoming.display_name}: ${incoming.message.slice(0, 80)}`);

  // 1. 게이트웨이 라우팅 (인증/권한 체크)
  const routeResult = routeMessage(incoming);

  // 2. 즉시 응답 (페어링/권한거부/시스템커맨드/워크플로우 대화)
  if (routeResult.action === "respond" ||
      routeResult.action === "pairing_required" ||
      routeResult.action === "permission_denied") {
    return routeResult.response ?? "";
  }

  const profileName = routeResult.profile ?? "observer";
  const userConfig = routeResult.user_config;
  const personality = userConfig?.personality as Record<string, unknown> | undefined;
  const userName = (userConfig?.name as string) ?? incoming.display_name;

  // 3. 개발 워크플로우 실행
  if (routeResult.action === "dev_execute") {
    const preMessage = routeResult.response ?? "";

    const response = await executeWithClaude(
      routeResult.task ?? incoming.message,
      profileName,
      incoming.user_id,
      personality,
      userName,
      routeResult.workDir,
    );

    return preMessage
      ? `${preMessage}\n\n---\n\n${truncate(response)}`
      : truncate(response);
  }

  // 4. 크론잡 커맨드 처리
  if (routeResult.response) {
    try {
      const cronCmd = JSON.parse(routeResult.response);
      if (cronCmd.action && cronCmd.action.startsWith("cron_")) {
        return handleCronCommand(incoming.user_id, cronCmd.action, cronCmd.args ?? {});
      }
    } catch {
      // 크론 커맨드가 아닌 경우 무시
    }
  }

  // 5. 일반 질문 → Claude CLI 실행 (worktree 없이)
  const response = await executeWithClaude(
    incoming.message,
    profileName,
    incoming.user_id,
    personality,
    userName,
  );

  return truncate(response);
}

function truncate(text: string): string {
  if (text.length > 4000) {
    return text.slice(0, 3900) + "\n\n... (응답이 잘렸습니다)";
  }
  return text;
}

// --- 채널 어댑터 시스템 ---

import { createEnabledAdapters } from "./adapters/registry.js";
import type { AdapterIncoming, ChannelAdapter } from "./adapters/types.js";

const TELEGRAM_COMMANDS = [
  { command: "dev", description: "개발 워크플로우 시작 (/dev 작업내용)" },
  { command: "help", description: "사용 가능한 명령 목록" },
  { command: "status", description: "Jarvis 상태 확인" },
  { command: "profile", description: "내 프로필 조회" },
  { command: "personality", description: "개인화 설정 조회" },
  { command: "cron", description: "크론잡 관리 (add/list/delete)" },
];

let activeAdapters: ChannelAdapter[] = [];

async function startAdapters(): Promise<void> {
  activeAdapters = createEnabledAdapters();

  if (activeAdapters.length === 0) {
    log("WARN", "활성화된 채널이 없습니다. config/channels.yml을 확인하세요.");
    return;
  }

  for (const adapter of activeAdapters) {
    try {
      await adapter.start(async (incoming: AdapterIncoming) => {
        const inc: IncomingMessage = {
          channel: incoming.channel as IncomingMessage["channel"],
          user_id: incoming.user_id,
          display_name: incoming.display_name,
          message: incoming.message,
          message_id: incoming.message_id,
          chat_id: incoming.chat_id,
        };
        return await handleMessage(inc);
      });

      // 봇 커맨드 메뉴 등록 (지원하는 채널만)
      if (adapter.registerCommands) {
        await adapter.registerCommands(TELEGRAM_COMMANDS).catch(() => { /* ignore */ });
      }

      log("INFO", `[${adapter.name}] 리스너 활성화됨`);
    } catch (err) {
      log("ERROR", `[${adapter.name}] 시작 실패: ${(err as Error).message}`);
    }
  }
}

async function stopAdapters(): Promise<void> {
  for (const adapter of activeAdapters) {
    if (adapter.stop) {
      await adapter.stop().catch(() => { /* ignore */ });
    }
  }
}

// --- 메인 ---
async function main(): Promise<void> {
  log("INFO", "=== Jarvis Daemon 시작 ===");

  // .env 로드
  loadEnv();

  // 자동 진단 (JARVIS_SKIP_DOCTOR=1로 우회 가능)
  if (!process.env.JARVIS_SKIP_DOCTOR) {
    const { runStartupChecks } = await import("../../../scripts/lib/diagnostics.js");
    const summary = runStartupChecks();
    const failures = summary.results.filter((r) => r.severity === "FAIL");
    if (failures.length > 0) {
      log("ERROR", "설정 오류로 데몬을 시작할 수 없습니다. `jarvis doctor`로 확인하세요.");
      for (const f of failures) {
        log("ERROR", `  ✗ ${f.name}: ${f.message}${f.hint ? ` (힌트: ${f.hint})` : ""}`);
      }
      log("ERROR", "우회하려면 JARVIS_SKIP_DOCTOR=1 환경변수를 설정하세요.");
      process.exit(2);
    }
  }

  // PID 파일 저장
  if (!existsSync(JARVIS_DIR)) mkdirSync(JARVIS_DIR, { recursive: true });
  writeFileSync(PID_FILE, String(process.pid));

  // 어댑터 시스템 시작
  await startAdapters();

  log("INFO", "Jarvis Daemon 대기 중...");

  // 종료 시그널 핸들링
  const cleanup = async () => {
    log("INFO", "=== Jarvis Daemon 종료 ===");
    await stopAdapters();
    try {
      const { unlinkSync } = require("node:fs");
      unlinkSync(PID_FILE);
    } catch { /* ignore */ }
    process.exit(0);
  };

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);

  // 무한 대기 (이벤트 루프 유지)
  await new Promise(() => {});
}

main().catch((err) => {
  log("ERROR", `Daemon 치명적 오류: ${err.message}`);
  process.exit(1);
});
