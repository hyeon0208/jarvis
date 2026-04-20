/**
 * Cron Runner — scheduled jobs in user files (cron_jobs) fire automatically.
 *
 * Tick every 60s. For each user file, for each enabled cron job whose cron
 * expression matches "now", execute the prompt via the provided executor and
 * send the result to that user's channel.
 *
 * Cron fields (5-field, local time): minute hour dayOfMonth month dayOfWeek
 *   Supported syntax per field: "*", "N", "N-M", "*\/N", "N,M,..."
 *
 * Duplicate-run guard: last_run_at is recorded in user file; skip if the job
 * already ran within the current minute.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChannelAdapter } from "./adapters/types.js";

const USERS_DIR = join(process.env.HOME ?? "~", ".jarvis", "users");

interface UserFile {
  user_id: string;
  name?: string;
  profile?: string;
  channel?: string;
  personality?: Record<string, unknown>;
  cron_jobs?: Array<{
    id: string;
    schedule: string;
    prompt: string;
    enabled: boolean;
    last_run_at: string | null;
    /**
     * Optional broadcast list. If present and non-empty, the cron result is sent
     * to every user_id in this list instead of the job owner.
     * Each entry uses the standard "{channel}:{external_id}" format
     * (e.g., "telegram:1613476146", "slack:U07ABC").
     */
    recipients?: string[];
  }>;
}

export interface CronExecuteFn {
  (args: {
    prompt: string;
    userId: string;
    profile: string;
    userName: string;
    personality: Record<string, unknown> | undefined;
  }): Promise<string>;
}

export interface CronLogFn {
  (level: string, message: string): void;
}

// ============================================================
// Cron expression matching
// ============================================================

function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const p = part.trim();
    if (p === "*") {
      for (let i = min; i <= max; i++) out.add(i);
      continue;
    }
    const stepMatch = p.match(/^(\*|(\d+)-(\d+))\/(\d+)$/);
    if (stepMatch) {
      const step = Number(stepMatch[4]);
      const start = stepMatch[1] === "*" ? min : Number(stepMatch[2]);
      const end = stepMatch[1] === "*" ? max : Number(stepMatch[3]);
      for (let i = start; i <= end; i += step) out.add(i);
      continue;
    }
    const rangeMatch = p.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      for (let i = Number(rangeMatch[1]); i <= Number(rangeMatch[2]); i++) out.add(i);
      continue;
    }
    if (/^\d+$/.test(p)) {
      out.add(Number(p));
    }
  }
  return out;
}

/**
 * Match a 5-field cron expression against a Date (local time).
 * Returns true if all five fields include the corresponding Date component.
 */
export function matchesCron(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [mF, hF, domF, monF, dowF] = parts;
  const minute = parseField(mF, 0, 59);
  const hour = parseField(hF, 0, 23);
  const dom = parseField(domF, 1, 31);
  const month = parseField(monF, 1, 12);
  const dow = parseField(dowF, 0, 6); // 0 = Sunday

  return (
    minute.has(date.getMinutes()) &&
    hour.has(date.getHours()) &&
    dom.has(date.getDate()) &&
    month.has(date.getMonth() + 1) &&
    dow.has(date.getDay())
  );
}

// ============================================================
// User file enumeration + update
// ============================================================

function listAllUserFiles(): Array<{ path: string; data: UserFile }> {
  if (!existsSync(USERS_DIR)) return [];
  const out: Array<{ path: string; data: UserFile }> = [];
  try {
    for (const name of readdirSync(USERS_DIR)) {
      if (!name.endsWith(".json")) continue;
      const filePath = join(USERS_DIR, name);
      try {
        const data = JSON.parse(readFileSync(filePath, "utf-8")) as UserFile;
        out.push({ path: filePath, data });
      } catch {
        // 개별 파일 파싱 실패는 무시
      }
    }
  } catch {
    // 디렉토리 읽기 실패는 무시
  }
  return out;
}

function updateJobLastRun(
  filePath: string,
  jobId: string,
  timestamp: string,
): void {
  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8")) as UserFile;
    const job = (data.cron_jobs ?? []).find((j) => j.id === jobId);
    if (!job) return;
    job.last_run_at = timestamp;
    writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch {
    // 무시 (다음 tick에서 또 매칭될 위험은 현재 분 보호 로직이 방지)
  }
}

/** 같은 분에 이미 실행됐는지 (YYYY-MM-DDTHH:MM 비교) */
function alreadyRanThisMinute(lastRunAt: string | null, now: Date): boolean {
  if (!lastRunAt) return false;
  const lastMinute = lastRunAt.slice(0, 16); // "2026-04-20T11:05"
  const nowMinute = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
  return lastMinute === nowMinute;
}

// ============================================================
// Send to channel
// ============================================================

async function sendToUserChannel(
  adapters: ChannelAdapter[],
  userId: string,
  message: string,
  log: CronLogFn,
): Promise<void> {
  // user_id 형식: "{channel}:{external_id}"
  const colonIdx = userId.indexOf(":");
  if (colonIdx < 0) {
    log("WARN", `[cron] user_id에 channel prefix가 없음: ${userId} — 전송 스킵`);
    return;
  }
  const channelName = userId.slice(0, colonIdx);
  const chatId = userId.slice(colonIdx + 1);

  const adapter = adapters.find((a) => a.name === channelName);
  if (!adapter) {
    log(
      "WARN",
      `[cron] 활성 adapter 없음 (channel=${channelName}) — 전송 스킵`,
    );
    return;
  }

  try {
    await adapter.send({ chat_id: chatId, message });
    log("INFO", `[cron] 전송 완료 → ${userId} (${message.length}자)`);
  } catch (err) {
    log(
      "ERROR",
      `[cron] 전송 실패 (${userId}): ${err instanceof Error ? err.message : err}`,
    );
  }
}

// ============================================================
// Main tick loop
// ============================================================

export interface CronRunnerOptions {
  adapters: ChannelAdapter[];
  execute: CronExecuteFn;
  log: CronLogFn;
}

/**
 * Start cron runner. Returns a stop function.
 * First tick fires at the next minute boundary; subsequent ticks every 60s.
 */
export function startCronRunner(opts: CronRunnerOptions): () => void {
  const { adapters, execute, log } = opts;

  const tick = async () => {
    const now = new Date();
    const users = listAllUserFiles();

    for (const { path: filePath, data: user } of users) {
      for (const job of user.cron_jobs ?? []) {
        if (!job.enabled) continue;
        if (!matchesCron(job.schedule, now)) continue;
        if (alreadyRanThisMinute(job.last_run_at, now)) continue;

        // 즉시 mark (중복 방지) — tick 비동기 병렬 실행 시에도 안전
        const runAt = now.toISOString();
        updateJobLastRun(filePath, job.id, runAt);

        log(
          "INFO",
          `[cron] 실행: user=${user.user_id} job=${job.id} schedule="${job.schedule}" prompt="${job.prompt.slice(0, 60)}..."`,
        );

        // recipients 지정 시 브로드캐스트, 없으면 소유자에게만 전송
        const recipients =
          job.recipients && job.recipients.length > 0
            ? job.recipients
            : [user.user_id];

        // 비동기 실행 (다음 tick 차단하지 않음) — 실행은 1회, 전송은 N회
        execute({
          prompt: job.prompt,
          userId: user.user_id, // 세션/메모리는 소유자 기준 (일관성)
          profile: user.profile ?? "observer",
          userName: user.name ?? user.user_id,
          personality: user.personality,
        })
          .then(async (response) => {
            if (!response) return;
            for (const recipient of recipients) {
              await sendToUserChannel(adapters, recipient, response, log);
            }
          })
          .catch((err) => {
            log(
              "ERROR",
              `[cron] 실행 실패 (user=${user.user_id} job=${job.id}): ${err instanceof Error ? (err.stack ?? err.message) : err}`,
            );
          });
      }
    }
  };

  // 첫 tick을 다음 분 경계에 맞추기 (0초 정렬) — cron 직관과 일치
  const now = Date.now();
  const msUntilNextMinute = 60_000 - (now % 60_000);
  const timeoutId = setTimeout(() => {
    tick().catch(() => { /* tick 내부에서 처리 */ });
    const intervalId = setInterval(() => {
      tick().catch(() => { /* tick 내부에서 처리 */ });
    }, 60_000);
    // stop 함수 교체
    stopRef.stop = () => clearInterval(intervalId);
  }, msUntilNextMinute);

  const stopRef: { stop: () => void } = {
    stop: () => clearTimeout(timeoutId),
  };

  log("INFO", `[cron] runner 시작 (첫 tick: ${Math.round(msUntilNextMinute / 1000)}초 후)`);
  return () => stopRef.stop();
}
