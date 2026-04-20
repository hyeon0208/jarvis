#!/usr/bin/env bun

/**
 * Cron CLI — inspect and manually trigger cron jobs for testing.
 *
 * Usage:
 *   jarvis cron list                  — 모든 유저의 cron_jobs 요약
 *   jarvis cron list <user_id>        — 특정 유저의 cron_jobs
 *   jarvis cron run <job_id>          — 해당 job을 즉시 실행 (터미널에 결과 출력)
 *   jarvis cron run <job_id> --send   — 실행 + 해당 user 채널로도 전송
 *
 * Note:
 *   cron runner(데몬)와 달리 이 CLI는 schedule 매칭 없이 강제 실행하며,
 *   last_run_at도 건드리지 않습니다 (테스트 용도).
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  buildClaudeArgs,
  buildPersonalityPrompt,
} from "../packages/gateway-server/src/permissions.js";
import {
  getOrCreateClaudeSessionId,
  markClaudeSessionStarted,
  hasClaudeSessionJsonl,
} from "../packages/gateway-server/src/auth.js";
import { createEnabledAdapters } from "../packages/gateway-server/src/adapters/registry.js";
import { loadEnvFile } from "./lib/config.js";

// daemon.ts와 동일하게 .env를 process.env로 주입
// (adapter의 isAvailable()이 TELEGRAM_BOT_TOKEN 등을 체크하므로 필수)
function bootstrapEnv(): void {
  try {
    const envVars = loadEnvFile();
    for (const [key, value] of Object.entries(envVars)) {
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env 없거나 파싱 실패 시에도 CLI 대부분 명령은 동작하므로 통과
  }
}
bootstrapEnv();

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const USERS_DIR = join(process.env.HOME ?? "~", ".jarvis", "users");
const SANDBOX_ROOT = join(process.env.HOME ?? "~", ".jarvis", "sandboxes");

interface UserFile {
  user_id: string;
  name?: string;
  profile?: string;
  personality?: Record<string, unknown>;
  cron_jobs?: Array<{
    id: string;
    schedule: string;
    prompt: string;
    enabled: boolean;
    last_run_at: string | null;
    recipients?: string[];
  }>;
}

function listUsers(): UserFile[] {
  if (!existsSync(USERS_DIR)) return [];
  const out: UserFile[] = [];
  for (const name of readdirSync(USERS_DIR)) {
    if (!name.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(readFileSync(join(USERS_DIR, name), "utf-8")) as UserFile);
    } catch {
      // 파싱 실패는 무시
    }
  }
  return out;
}

function findJob(jobId: string): { user: UserFile; job: UserFile["cron_jobs"][number] } | null {
  for (const user of listUsers()) {
    const job = (user.cron_jobs ?? []).find((j) => j.id === jobId);
    if (job) return { user, job };
  }
  return null;
}

function ensureSandbox(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_") || "anonymous";
  const dir = join(SANDBOX_ROOT, safe);
  if (!existsSync(dir)) {
    const { mkdirSync } = require("node:fs");
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// ============================================================
// Commands
// ============================================================

function cmdList(userIdFilter?: string): void {
  const users = listUsers();
  let total = 0;
  for (const user of users) {
    if (userIdFilter && user.user_id !== userIdFilter) continue;
    const jobs = user.cron_jobs ?? [];
    if (jobs.length === 0) continue;

    console.log(`\n${GREEN}${user.user_id}${RESET} ${DIM}(${user.name ?? "-"}, ${user.profile ?? "-"})${RESET}`);
    for (const job of jobs) {
      const mark = job.enabled ? `${GREEN}●${RESET}` : `${DIM}○${RESET}`;
      const last = job.last_run_at ? job.last_run_at.slice(0, 16) : "never";
      const preview = job.prompt.replace(/\s+/g, " ").slice(0, 60);
      const recipients =
        job.recipients && job.recipients.length > 0
          ? job.recipients.join(", ")
          : `(owner: ${user.user_id})`;
      console.log(`  ${mark} ${job.id}`);
      console.log(`     schedule: ${job.schedule}    last_run: ${last}`);
      console.log(`     recipients: ${recipients}`);
      console.log(`     ${DIM}${preview}...${RESET}`);
      total++;
    }
  }
  if (total === 0) console.log(`${DIM}등록된 cron_jobs 없음${RESET}`);
}

async function cmdRun(jobId: string, opts: { send: boolean }): Promise<void> {
  const found = findJob(jobId);
  if (!found) {
    console.error(`${RED}job 못 찾음: ${jobId}${RESET}`);
    process.exit(1);
  }
  const { user, job } = found;

  console.log(`${GREEN}▶ ${job.id}${RESET} ${DIM}(user=${user.user_id}, schedule="${job.schedule}", enabled=${job.enabled})${RESET}`);
  console.log(`${DIM}prompt: ${job.prompt.slice(0, 200)}...${RESET}\n`);

  // 실제 cron runner와 동일한 spawn 흐름
  const profile = user.profile ?? "observer";
  const userName = user.name ?? user.user_id;
  const personality = user.personality ?? {};

  const personalityPrompt = buildPersonalityPrompt(personality, userName, "cron-manual", user.user_id);
  const args = buildClaudeArgs(profile, job.prompt, {
    systemPrompt: personalityPrompt,
  });

  // 세션 연속성 유지 — jsonl 존재 여부로 ground truth 판단
  const sessionHandle = getOrCreateClaudeSessionId(user.user_id);
  const sessionExists =
    sessionHandle.started || hasClaudeSessionJsonl(sessionHandle.session_id);
  const sessionFlag = sessionExists ? "--resume" : "--session-id";
  args.push(sessionFlag, sessionHandle.session_id);

  const cwdDir = ensureSandbox(user.user_id);
  const channelName = user.user_id.includes(":") ? user.user_id.split(":")[0] : "owner";

  console.log(`${DIM}executing: claude ... ${sessionFlag} ${sessionHandle.session_id.slice(0, 8)}... (cwd=${cwdDir})${RESET}\n`);

  const startedAt = Date.now();
  const child = spawn("claude", args, {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: cwdDir,
    timeout: 5 * 60 * 1000,
    env: {
      ...process.env,
      JARVIS_USER_ID: user.user_id,
      JARVIS_USER_NAME: userName,
      JARVIS_CHANNEL: channelName,
    },
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
  child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

  const exitCode = await new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? -1));
    child.on("error", () => resolve(-1));
  });

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  if (exitCode !== 0) {
    console.error(`${RED}claude 종료 코드=${exitCode} (${elapsed}s)${RESET}`);
    if (stderr) console.error(`${DIM}stderr: ${stderr.slice(0, 500)}${RESET}`);
    process.exit(1);
  }

  // 정상 종료 → started 플래그 정정 (jsonl 존재로 resume한 경우도 동기화)
  if (!sessionHandle.started) markClaudeSessionStarted(user.user_id);

  const response = stdout.trim();
  console.log(`${GREEN}✓ 완료 (${elapsed}s, ${response.length}자)${RESET}\n`);
  console.log("─".repeat(60));
  console.log(response);
  console.log("─".repeat(60));

  if (opts.send && response) {
    const recipients =
      job.recipients && job.recipients.length > 0
        ? job.recipients
        : [user.user_id];
    console.log(`\n${DIM}수신자: ${recipients.join(", ")}${RESET}`);
    for (const recipient of recipients) {
      await sendToChannel(recipient, response);
    }
  }
}

// ============================================================
// Recipients CRUD
// ============================================================

/**
 * 주어진 jobId가 속한 user 파일에서 cron_jobs를 변경해 저장.
 * 반환: { user, updatedJob } 또는 null (job 미존재)
 */
function mutateJob(
  jobId: string,
  mutator: (job: UserFile["cron_jobs"][number]) => void,
): { userId: string; job: UserFile["cron_jobs"][number] } | null {
  if (!existsSync(USERS_DIR)) return null;

  for (const name of readdirSync(USERS_DIR)) {
    if (!name.endsWith(".json")) continue;
    const filePath = join(USERS_DIR, name);
    try {
      const data = JSON.parse(readFileSync(filePath, "utf-8")) as UserFile;
      const job = (data.cron_jobs ?? []).find((j) => j.id === jobId);
      if (!job) continue;

      mutator(job);
      writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
      return { userId: data.user_id, job };
    } catch {
      // 개별 파일 실패는 무시하고 다음 파일로
    }
  }
  return null;
}

function cmdRecipientsList(jobId: string): void {
  const found = findJob(jobId);
  if (!found) {
    console.error(`${RED}job 못 찾음: ${jobId}${RESET}`);
    process.exit(1);
  }
  const { user, job } = found;
  const list = job.recipients ?? [];

  console.log(`${GREEN}${job.id}${RESET} ${DIM}(owner: ${user.user_id})${RESET}`);
  if (list.length === 0) {
    console.log(`  ${DIM}recipients 미지정 → 기본값: [${user.user_id}] (소유자만)${RESET}`);
    return;
  }
  console.log(`  recipients (${list.length}):`);
  for (const r of list) {
    const isOwner = r === user.user_id;
    console.log(`    - ${r}${isOwner ? `  ${DIM}(owner)${RESET}` : ""}`);
  }
}

function cmdRecipientsAdd(jobId: string, newIds: string[]): void {
  if (newIds.length === 0) {
    console.error(`${RED}추가할 user_id를 1개 이상 입력하세요${RESET}`);
    process.exit(1);
  }
  for (const id of newIds) {
    if (!id.includes(":")) {
      console.error(`${RED}user_id 형식 오류: "${id}" — "{channel}:{external_id}" 형태여야 함${RESET}`);
      process.exit(1);
    }
  }

  const result = mutateJob(jobId, (job) => {
    const set = new Set(job.recipients ?? []);
    for (const id of newIds) set.add(id);
    job.recipients = Array.from(set);
  });

  if (!result) {
    console.error(`${RED}job 못 찾음: ${jobId}${RESET}`);
    process.exit(1);
  }
  console.log(`${GREEN}✓ 추가됨${RESET} (${newIds.length}명): ${newIds.join(", ")}`);
  console.log(`${DIM}현재 recipients: [${(result.job.recipients ?? []).join(", ")}]${RESET}`);
}

function cmdRecipientsRemove(jobId: string, targetIds: string[]): void {
  if (targetIds.length === 0) {
    console.error(`${RED}제거할 user_id를 1개 이상 입력하세요${RESET}`);
    process.exit(1);
  }

  const result = mutateJob(jobId, (job) => {
    const set = new Set(job.recipients ?? []);
    for (const id of targetIds) set.delete(id);
    job.recipients = Array.from(set);
  });

  if (!result) {
    console.error(`${RED}job 못 찾음: ${jobId}${RESET}`);
    process.exit(1);
  }
  const remaining = result.job.recipients ?? [];
  console.log(`${GREEN}✓ 제거 요청 처리${RESET} (${targetIds.length}명): ${targetIds.join(", ")}`);
  if (remaining.length === 0) {
    console.log(`${DIM}recipients 빈 배열 → 다음 실행부터 소유자(${result.userId})에게만 전송${RESET}`);
  } else {
    console.log(`${DIM}현재 recipients (${remaining.length}): [${remaining.join(", ")}]${RESET}`);
  }
}

function cmdRecipientsClear(jobId: string): void {
  const result = mutateJob(jobId, (job) => {
    delete job.recipients;
  });
  if (!result) {
    console.error(`${RED}job 못 찾음: ${jobId}${RESET}`);
    process.exit(1);
  }
  console.log(`${GREEN}✓ recipients 필드 제거됨${RESET} → 기본값(소유자 ${result.userId})으로 복귀`);
}

async function sendToChannel(userId: string, message: string): Promise<void> {
  const colonIdx = userId.indexOf(":");
  if (colonIdx < 0) {
    console.log(`${YELLOW}채널 전송 스킵 (user_id에 channel prefix 없음)${RESET}`);
    return;
  }
  const channelName = userId.slice(0, colonIdx);
  const chatId = userId.slice(colonIdx + 1);

  const adapters = createEnabledAdapters();
  const adapter = adapters.find((a) => a.name === channelName);
  if (!adapter) {
    console.log(`${YELLOW}채널 전송 스킵 (활성 adapter 없음: ${channelName})${RESET}`);
    return;
  }

  try {
    // 일부 adapter는 start가 없어도 send 가능 (telegram은 토큰만 있으면 OK)
    await adapter.send({ chat_id: chatId, message });
    console.log(`\n${GREEN}📨 ${channelName} 채널로 전송 완료 (${chatId})${RESET}`);
  } catch (err) {
    console.error(
      `${RED}채널 전송 실패: ${err instanceof Error ? err.message : err}${RESET}`,
    );
  }
}

// ============================================================
// Dispatch
// ============================================================

function printHelp(): void {
  console.log("jarvis cron — cron_jobs CLI");
  console.log("");
  console.log("  jarvis cron list [user_id]                       모든 cron_jobs 또는 특정 유저의 목록");
  console.log("  jarvis cron run <job_id>                         즉시 실행 (결과를 터미널에 출력)");
  console.log("  jarvis cron run <job_id> --send                  실행 + recipients 채널로 전송");
  console.log("");
  console.log("  jarvis cron recipients <job_id>                  브로드캐스트 수신자 목록");
  console.log("  jarvis cron recipients <job_id> add <uid>...     수신자 추가 (여러 명 가능)");
  console.log("  jarvis cron recipients <job_id> remove <uid>...  수신자 제거");
  console.log("  jarvis cron recipients <job_id> clear            recipients 필드 제거 (소유자 기본값으로)");
  console.log("");
  console.log("  user_id 형식: {channel}:{external_id}  (예: telegram:1613476146, slack:U07ABC)");
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }

  if (cmd === "list") {
    cmdList(rest[0]);
    return;
  }

  if (cmd === "run") {
    const jobId = rest[0];
    if (!jobId) {
      console.error(`${RED}job_id를 입력하세요${RESET}`);
      printHelp();
      process.exit(1);
    }
    const send = rest.includes("--send");
    await cmdRun(jobId, { send });
    return;
  }

  if (cmd === "recipients") {
    const jobId = rest[0];
    const sub = rest[1];
    if (!jobId) {
      console.error(`${RED}job_id를 입력하세요${RESET}`);
      printHelp();
      process.exit(1);
    }
    if (!sub) {
      cmdRecipientsList(jobId);
      return;
    }
    const args = rest.slice(2);
    if (sub === "add") {
      cmdRecipientsAdd(jobId, args);
      return;
    }
    if (sub === "remove") {
      cmdRecipientsRemove(jobId, args);
      return;
    }
    if (sub === "clear") {
      cmdRecipientsClear(jobId);
      return;
    }
    console.error(`${RED}알 수 없는 recipients 서브명령: ${sub}${RESET}`);
    printHelp();
    process.exit(1);
  }

  console.error(`${RED}알 수 없는 명령: ${cmd}${RESET}`);
  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error(`${RED}실행 실패:${RESET}`, err instanceof Error ? err.stack : err);
  process.exit(1);
});
