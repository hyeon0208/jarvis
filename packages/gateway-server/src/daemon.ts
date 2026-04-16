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
import { loadUserConfig } from "./auth.js";
import { addCronJob, listCronJobs, deleteCronJob, toggleCronJob } from "./cron.js";

// --- 설정 ---
const JARVIS_DIR = join(process.env.HOME ?? "~", ".jarvis");
const LOG_FILE = join(JARVIS_DIR, "daemon.log");
const PID_FILE = join(JARVIS_DIR, "daemon.pid");
const CONFIG_FILE = join(process.env.HOME ?? "~", "jarvis", ".env");

// --- 로깅 ---
function log(level: string, message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}`;
  console.error(line);

  try {
    if (!existsSync(JARVIS_DIR)) mkdirSync(JARVIS_DIR, { recursive: true });
    appendFileSync(LOG_FILE, line + "\n");
  } catch {
    // 로그 파일 쓰기 실패 무시
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
  personality?: Record<string, unknown>,
  userName?: string,
): Promise<string> {
  const personalityPrompt = buildPersonalityPrompt(
    personality ?? {},
    userName,
    "external-channel",
  );

  const args = buildClaudeArgs(profileName, prompt, {
    systemPrompt: personalityPrompt,
    maxBudget: profileName === "admin" ? undefined : 0.5, // admin 외 $0.5 제한
  });

  log("INFO", `claude 실행: profile=${profileName}, prompt=${prompt.slice(0, 80)}...`);

  return new Promise((resolve) => {
    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5 * 60 * 1000, // 5분 타임아웃
      env: { ...process.env },
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

  // 2. 즉시 응답 (페어링/권한거부/시스템커맨드)
  if (routeResult.action !== "execute") {
    return routeResult.response ?? "";
  }

  // 3. 크론잡 커맨드 처리
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

  // 4. 일반 요청 → Claude CLI 실행
  const profileName = routeResult.profile ?? "observer";
  const userConfig = routeResult.user_config;
  const personality = userConfig?.personality as Record<string, unknown> | undefined;
  const userName = (userConfig?.name as string) ?? incoming.display_name;

  const channelPrompt = incoming.message;

  const response = await executeWithClaude(
    channelPrompt,
    profileName,
    personality,
    userName,
  );

  // Telegram/Discord 메시지 길이 제한 (4096자)
  if (response.length > 4000) {
    return response.slice(0, 3900) + "\n\n... (응답이 잘렸습니다. 상세 내용은 터미널에서 확인하세요)";
  }

  return response;
}

// --- Telegram 리스너 ---
async function startTelegramListener(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    log("WARN", "TELEGRAM_BOT_TOKEN 미설정 — Telegram 비활성");
    return;
  }

  log("INFO", "Telegram 리스너 시작...");

  // 간단한 long polling 방식 (telegraf 의존성 없이)
  let offset = 0;

  const poll = async () => {
    try {
      const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=30`;
      const res = await fetch(url);
      const data = (await res.json()) as {
        ok: boolean;
        result: Array<{
          update_id: number;
          message?: {
            message_id: number;
            chat: { id: number };
            from?: { id: number; first_name: string; username?: string };
            text?: string;
          };
        }>;
      };

      if (!data.ok || !data.result) return;

      for (const update of data.result) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (!msg?.text || !msg.from) continue;

        const incoming: IncomingMessage = {
          channel: "telegram",
          user_id: `telegram:${msg.chat.id}`,
          display_name: msg.from.first_name,
          message: msg.text,
          message_id: String(msg.message_id),
          chat_id: String(msg.chat.id),
        };

        // 비동기로 처리 (다음 폴링 차단하지 않음)
        handleMessage(incoming)
          .then(async (response) => {
            if (!response) return;
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: msg.chat.id,
                text: response,
              }),
            });
          })
          .catch((err) => {
            log("ERROR", `Telegram 응답 실패: ${err.message}`);
          });
      }
    } catch (err) {
      log("ERROR", `Telegram 폴링 오류: ${(err as Error).message}`);
    }
  };

  // 폴링 루프
  const loop = async () => {
    while (true) {
      await poll();
      await new Promise((r) => setTimeout(r, 1000));
    }
  };

  loop().catch((err) => log("ERROR", `Telegram 루프 종료: ${err.message}`));
  log("INFO", "Telegram 리스너 활성화됨");
}

// --- Discord 리스너 ---
async function startDiscordListener(): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    log("WARN", "DISCORD_BOT_TOKEN 미설정 — Discord 비활성");
    return;
  }

  try {
    const { Client, GatewayIntentBits } = await import("discord.js");

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    client.on("ready", () => {
      log("INFO", `Discord 봇 로그인: ${client.user?.tag}`);
    });

    client.on("messageCreate", async (message) => {
      if (message.author.bot) return;

      const incoming: IncomingMessage = {
        channel: "discord",
        user_id: `discord:${message.author.id}`,
        display_name: message.author.displayName ?? message.author.username,
        message: message.content,
        message_id: message.id,
        chat_id: message.channelId,
      };

      const response = await handleMessage(incoming);
      if (response) {
        await message.reply(response).catch((err) => {
          log("ERROR", `Discord 응답 실패: ${err.message}`);
        });
      }
    });

    await client.login(token);
    log("INFO", "Discord 리스너 활성화됨");
  } catch (err) {
    log("ERROR", `Discord 시작 실패: ${(err as Error).message}`);
  }
}

// --- Slack 리스너 ---
async function startSlackListener(): Promise<void> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const appToken = process.env.SLACK_APP_TOKEN;
  if (!botToken || !appToken) {
    log("WARN", "SLACK_BOT_TOKEN/SLACK_APP_TOKEN 미설정 — Slack 비활성");
    return;
  }

  try {
    const { App } = await import("@slack/bolt");

    const app = new App({ token: botToken, appToken, socketMode: true });

    app.message(async ({ message, say }) => {
      if (!("text" in message) || !("user" in message)) return;
      if ("subtype" in message) return;

      const incoming: IncomingMessage = {
        channel: "slack",
        user_id: `slack:${message.user}`,
        display_name: message.user as string,
        message: message.text ?? "",
        message_id: message.ts,
        chat_id: message.channel,
      };

      const response = await handleMessage(incoming);
      if (response) {
        await say(response).catch((err: Error) => {
          log("ERROR", `Slack 응답 실패: ${err.message}`);
        });
      }
    });

    await app.start();
    log("INFO", "Slack 리스너 활성화됨 (Socket Mode)");
  } catch (err) {
    log("ERROR", `Slack 시작 실패: ${(err as Error).message}`);
  }
}

// --- 메인 ---
async function main(): Promise<void> {
  log("INFO", "=== Jarvis Daemon 시작 ===");

  // .env 로드
  loadEnv();

  // PID 파일 저장
  if (!existsSync(JARVIS_DIR)) mkdirSync(JARVIS_DIR, { recursive: true });
  writeFileSync(PID_FILE, String(process.pid));

  // 채널 리스너 시작 (설정된 것만 활성화)
  await Promise.all([
    startTelegramListener(),
    startDiscordListener(),
    startSlackListener(),
  ]);

  log("INFO", "Jarvis Daemon 대기 중...");

  // 종료 시그널 핸들링
  const cleanup = () => {
    log("INFO", "=== Jarvis Daemon 종료 ===");
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
