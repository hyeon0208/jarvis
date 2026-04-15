import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const USERS_DIR = join(process.env.HOME ?? "~", ".jarvis", "users");

export interface CronJob {
  id: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  created_at: string;
  last_run_at: string | null;
}

/** 유저 파일에서 크론잡 로드 */
function loadUserCronJobs(userId: string): CronJob[] {
  const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = join(USERS_DIR, `${safeId}.json`);
  if (!existsSync(filePath)) return [];

  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    return data.cron_jobs ?? [];
  } catch {
    return [];
  }
}

/** 유저 파일에 크론잡 저장 */
function saveUserCronJobs(userId: string, jobs: CronJob[]): void {
  const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = join(USERS_DIR, `${safeId}.json`);
  if (!existsSync(filePath)) return;

  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    data.cron_jobs = jobs;
    writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch {
    // 저장 실패 무시
  }
}

/** 자연어 스케줄을 크론 표현식으로 변환 */
function parseSchedule(input: string): string | null {
  const lower = input.toLowerCase().trim();

  // 간단한 한국어 패턴 매칭
  const patterns: Array<[RegExp, string]> = [
    [/^매일\s*(\d{1,2})시$/, "0 $1 * * *"],
    [/^매일\s*오전\s*(\d{1,2})시$/, "0 $1 * * *"],
    [/^매일\s*오후\s*(\d{1,2})시$/, "0 {pm} * * *"],
    [/^평일\s*(\d{1,2})시$/, "0 $1 * * 1-5"],
    [/^매주\s*월요일\s*(\d{1,2})시$/, "0 $1 * * 1"],
    [/^매시간$/, "0 * * * *"],
    [/^(\d{1,2})분\s*마다$/, "*/$1 * * * *"],
  ];

  for (const [regex, template] of patterns) {
    const match = lower.match(regex);
    if (match) {
      let result = template;
      if (result.includes("{pm}") && match[1]) {
        result = result.replace("{pm}", String(Number(match[1]) + 12));
      } else if (match[1]) {
        result = result.replace("$1", match[1]);
      }
      return result;
    }
  }

  // 이미 크론 표현식이면 그대로 반환
  if (/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(input.trim())) {
    return input.trim();
  }

  return null;
}

/** 크론잡 추가 */
export function addCronJob(
  userId: string,
  promptInput: string,
): { success: boolean; job?: CronJob; error?: string } {
  // "매일 9시 할 일 정리" → schedule: "0 9 * * *", prompt: "할 일 정리"
  // 첫 시간 표현을 스케줄로, 나머지를 프롬프트로 분리

  const timePatterns = [
    /^(매일\s*(?:오전|오후)?\s*\d{1,2}시)\s+/,
    /^(평일\s*\d{1,2}시)\s+/,
    /^(매주\s*\S+\s*\d{1,2}시)\s+/,
    /^(매시간)\s+/,
    /^(\d{1,2}분\s*마다)\s+/,
  ];

  let scheduleStr: string | null = null;
  let prompt = promptInput;

  for (const pattern of timePatterns) {
    const match = promptInput.match(pattern);
    if (match) {
      scheduleStr = parseSchedule(match[1]);
      prompt = promptInput.slice(match[0].length).trim();
      break;
    }
  }

  if (!scheduleStr) {
    return {
      success: false,
      error:
        "스케줄을 파싱할 수 없습니다. 예: '매일 9시 할 일 정리', '평일 10시 스탠드업'",
    };
  }

  if (!prompt) {
    return { success: false, error: "실행할 프롬프트를 입력해주세요." };
  }

  const job: CronJob = {
    id: `cron-${randomBytes(4).toString("hex")}`,
    schedule: scheduleStr,
    prompt,
    enabled: true,
    created_at: new Date().toISOString(),
    last_run_at: null,
  };

  const jobs = loadUserCronJobs(userId);
  jobs.push(job);
  saveUserCronJobs(userId, jobs);

  return { success: true, job };
}

/** 크론잡 목록 */
export function listCronJobs(userId: string): CronJob[] {
  return loadUserCronJobs(userId);
}

/** 크론잡 삭제 */
export function deleteCronJob(
  userId: string,
  jobId: string,
): boolean {
  const jobs = loadUserCronJobs(userId);
  const filtered = jobs.filter((j) => j.id !== jobId);
  if (filtered.length === jobs.length) return false;
  saveUserCronJobs(userId, filtered);
  return true;
}

/** 크론잡 토글 */
export function toggleCronJob(
  userId: string,
  jobId: string,
): { success: boolean; enabled?: boolean } {
  const jobs = loadUserCronJobs(userId);
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return { success: false };
  job.enabled = !job.enabled;
  saveUserCronJobs(userId, jobs);
  return { success: true, enabled: job.enabled };
}
