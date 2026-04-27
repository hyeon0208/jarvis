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
import {
  buildClaudeArgs,
  buildPersonalityPrompt,
  getProfileConfig,
  mergePersonality,
} from "./permissions.js";
import {
  loadUserConfig,
  getOrCreateClaudeSessionId,
  markClaudeSessionStarted,
  hasClaudeSessionJsonl,
  resetClaudeSessionId,
  setPendingCompactSummary,
  consumePendingCompactSummary,
  touchUserActivity,
  getOrCreateThreadSessionId,
  markThreadSessionStarted,
} from "./auth.js";
import { addCronJob, listCronJobs, deleteCronJob, toggleCronJob } from "./cron.js";
import { maskTokens } from "./log-safe.js";
// worktree는 workflow.ts가 관리 (router → workflow → worktree)

// --- 설정 ---
const JARVIS_DIR = join(process.env.HOME ?? "~", ".jarvis");
const LOG_FILE = join(JARVIS_DIR, "daemon.log");
const PID_FILE = join(JARVIS_DIR, "daemon.pid");
const CONFIG_FILE = join(process.env.HOME ?? "~", "jarvis", ".env");
const PROJECT_DIR = process.env.JARVIS_PROJECT_DIR ?? ""; // 프로젝트 디렉토리 (설정 시 worktree 활성화)
const SANDBOX_ROOT = join(JARVIS_DIR, "sandboxes"); // 유저별 cwd 샌드박스 (~/.jarvis/sandboxes/)

/**
 * 채널별 출력 형식 지침.
 *
 * 외부 채널(Telegram 등)은 plain-text UI라 모델이 디폴트로 뱉는 markdown
 * (`**bold**`, `# heading`, ```code blocks``` 등)이 그대로 노출돼 가독성을 망친다.
 * `parse_mode`를 켜는 대신 시스템 프롬프트에서 출력 자체를 plain-text로 강제한다
 * (escape 실패로 메시지 전송이 깨질 위험을 회피).
 *
 * 채널 키는 user_id의 prefix(`telegram:`/`slack:`/`discord:`)와 일치한다.
 * Slack/Discord는 자체 markdown을 잘 렌더링하므로 일단 추가하지 않는다 (KISS).
 */
const CHANNEL_OUTPUT_RULES: Record<string, string> = {
  telegram:
    "응답은 Telegram chat의 plain text로 표시된다. " +
    "**bold**, *italic*, `code`, ```code blocks```, # headings 같은 마크다운 문법을 절대 사용하지 마라. " +
    "강조가 필요하면 줄바꿈이나 \"따옴표\"로 표현하고, 목록은 하이픈(- )이나 가운뎃점(·)만 사용하라.",
};

function getChannelFromUserId(userId: string): string {
  return userId.includes(":") ? userId.split(":")[0] : "owner";
}

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

/**
 * 스레드 공유 세션용 공용 샌드박스.
 *
 * 왜 필요한가: Claude Code는 세션 jsonl을 `cwd 해시` 기준으로 저장하므로,
 * 스레드 참여자 A/B가 서로 다른 user별 샌드박스를 cwd로 쓰면 같은 UUID여도
 * A가 만든 jsonl을 B가 resume 시 못 찾는다 ("No conversation found").
 * 스레드는 원래 맥락 공유 구조이므로 공용 cwd가 의미에도 맞음.
 *
 * 격리 영향:
 *   - cwd는 항상 빈 디렉토리로 유지됨 (홈 탐색 차단)
 *   - 프로필별 --add-dir / --allowedTools는 user_id 단위라 그대로 개별 유지
 *   - 즉 "cwd 해시를 맞추기 위한" 공용 공간일 뿐, 보안 경계 변화 없음
 */
function ensureThreadSandbox(scopeKey: string): string {
  const safe = scopeKey.replace(/[^a-zA-Z0-9_-]/g, "_") || "thread-anon";
  const dir = join(SANDBOX_ROOT, safe);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// --- 로깅 ---
function log(level: string, message: string): void {
  const timestamp = new Date().toISOString();
  // 어댑터가 URL에 토큰을 직접 박아놓고 fetch 실패 시 err.stack에 URL 포함될 수
  // 있어, 로그 기록 직전 한 번 필터링 (log-safe.ts:maskTokens)
  const line = `[${timestamp}] [${level}] ${maskTokens(message)}`;

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
  options?: {
    skipPendingSummary?: boolean;
    /**
     * 세션 UUID 조회 키. 지정하지 않으면 userId가 기본값 (기존 동작).
     * 공용 채널 스레드에서 같은 키(예: "slack:thread:C01:1712_ts")를 넘기면
     * 스레드 참여자 전원이 같은 Claude 세션 맥락을 공유합니다.
     * userId와 동일한 값이면 user 단위 저장소 사용, 다르면 thread-sessions.json 사용.
     */
    sessionScopeKey?: string;
  },
): Promise<string> {

  // /compact로 생성된 요약이 대기 중이면 이번 prompt 앞에 한 번만 주입
  // (compact 자체의 요약 호출에서는 재귀 방지를 위해 skipPendingSummary: true)
  if (options?.skipPendingSummary !== true) {
    const pendingSummary = consumePendingCompactSummary(userId);
    if (pendingSummary) {
      log(
        "INFO",
        `compact 요약 주입 (user=${userId}, ${pendingSummary.length}자)`,
      );
      prompt = `[이전 세션 요약]\n${pendingSummary}\n\n[현재 메시지]\n${prompt}`;
    }
  }

  // 프로필의 personality 기본값과 유저 personality를 병합 (유저 설정이 우선)
  // → profiles.yml에 personality를 박아두면 해당 프로필을 받은 전원에게 자동 적용
  //   (예: macho 프로필의 "상남자" 페르소나)
  const mergedPersonality = mergePersonality(personality, profileName);
  const personalityPrompt = buildPersonalityPrompt(
    mergedPersonality,
    userName,
    "external-channel",
    userId,
  );

  // 채널별 출력 형식 지침을 personality 뒤에 합성.
  // 예: Telegram은 plain-text UI라 markdown 금지 규칙을 강제 (CHANNEL_OUTPUT_RULES 참고).
  const channel = getChannelFromUserId(userId);
  const outputRule = CHANNEL_OUTPUT_RULES[channel];
  const combinedPrompt = outputRule
    ? `${personalityPrompt}\n\n${outputRule}`
    : personalityPrompt;

  const args = buildClaudeArgs(profileName, {
    systemPrompt: combinedPrompt,
    projectDir: workDir,
  });

  // 대화 컨텍스트 격리:
  //   user_id별로 영속적인 UUID를 1:1 매핑
  //   첫 호출: --session-id <UUID> (새 세션 생성)
  //   이후:   --resume <UUID>    (기존 세션 이어가기)
  //   /clear: UUID 리셋 → 다음 호출이 다시 --session-id로 시작
  //
  // scopeKey가 userId와 다르면 공용 스레드 세션을 조회
  // (여러 사용자가 같은 scopeKey로 들어와 같은 UUID에 --resume)
  const scopeKey = options?.sessionScopeKey ?? userId;
  const isThreadScope = scopeKey !== userId;
  const sessionHandle = isThreadScope
    ? getOrCreateThreadSessionId(scopeKey)
    : getOrCreateClaudeSessionId(userId);
  // 분기 기준: started 플래그와 실제 jsonl 존재 여부를 모두 확인.
  // 어느 쪽이든 true면 이미 세션이 있다는 의미 → --resume (ground truth 우선)
  const sessionExists = sessionHandle.started || hasClaudeSessionJsonl(sessionHandle.session_id);
  if (sessionExists) {
    args.push("--resume", sessionHandle.session_id);
  } else {
    args.push("--session-id", sessionHandle.session_id);
  }

  // prompt는 반드시 모든 플래그 뒤, `--` 분리자 다음에 와야 함.
  // (`- 불릿`으로 시작하는 prompt가 옵션으로 오인되는 것을 방지)
  args.push("--", prompt);

  const sessionMode = sessionExists ? "resume" : "new";
  const scopeTag = isThreadScope ? `thread[${scopeKey.slice(0, 40)}]` : `user[${userId}]`;
  log(
    "INFO",
    `claude 실행: profile=${profileName}, scope=${scopeTag}, session=${sessionHandle.session_id.slice(0, 8)}... (${sessionMode}), dir=${workDir ?? "sandbox"}, prompt=${prompt.slice(0, 80)}...`,
  );

  return new Promise((resolve) => {
    // 사용자별 메모리 격리 핵심:
    // 환경변수로 user_id를 주입하면 claude 자식 → MCP 서버 → IntentGate 훅까지
    // 모두 이 환경변수를 상속받아 자동으로 올바른 유저 컨텍스트로 동작합니다.
    // (LLM 자율성 의존 X, OS 프로세스 환경변수로 100% 보장)
    // cwd 정책:
    //   · workDir(예: /dev worktree)이 명시되면 무조건 그쪽
    //   · owner 프로필이면 $HOME — 홈에서 시작해 모델이 "여긴 빈 디렉토리네"로
    //     자기검열할 여지를 제거. permissions.ts에서 --add-dir / 로 시스템 전 경로도 열림.
    //   · thread scope(스레드 공유 세션)이면 스레드 공용 샌드박스
    //     → Claude Code가 저장하는 cwd 해시가 참여자 전원에게 같아야
    //       --resume이 동작 (다르면 "No conversation found")
    //   · 그 외 — user별 샌드박스 (~/.jarvis/sandboxes/{id}/, 빈 디렉토리)
    //   · 프로필별 접근 범위 차등은 --add-dir (permissions.ts:buildClaudeArgs)로 제어
    const isOwnerProfile = getProfileConfig(profileName)?.claude?.skip_permissions === true;
    const cwdDir =
      workDir ??
      (isOwnerProfile
        ? (process.env.HOME ?? "/")
        : (isThreadScope ? ensureThreadSandbox(scopeKey) : ensureSandbox(userId)));
    const cwdLabel = workDir
      ? "worktree"
      : isOwnerProfile
        ? "home"
        : isThreadScope
          ? "thread-sandbox"
          : "sandbox";
    log("INFO", `cwd: ${cwdDir} (${cwdLabel})`);

    const child = spawn("claude", args, {
      // stdin: "ignore" — prompt는 args로 전달되므로 stdin을 쓰지 않음.
      //   "pipe"로 두면 claude CLI가 stdin을 3초 기다리다 "no stdin data received" 경고 + exit 1 발생.
      stdio: ["ignore", "pipe", "pipe"],
      cwd: cwdDir,
      timeout: 5 * 60 * 1000,
      env: {
        ...process.env,
        JARVIS_USER_ID: userId,
        JARVIS_USER_NAME: userName ?? "",
        JARVIS_CHANNEL: channel,
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
        // started 플래그를 true로 정정 (jsonl 존재로 resume한 경우도 플래그 동기화)
        if (!sessionHandle.started) {
          if (isThreadScope) {
            markThreadSessionStarted(scopeKey);
          } else {
            markClaudeSessionStarted(userId);
          }
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
async function handleCronCommand(
  userId: string,
  action: string,
  args: Record<string, string>,
  userConfig?: Record<string, unknown>,
): Promise<string> {
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
    case "cron_run": {
      // 수동 트리거 — schedule 매칭 건너뛰고 즉시 실행.
      // 테스트/디버깅 용도. last_run_at은 건드리지 않음 (스케줄 충돌 방지).
      const jobId = args.job_id ?? "";
      const jobs = listCronJobs(userId);
      const job = jobs.find((j) => j.id === jobId);
      if (!job) return `크론잡을 찾을 수 없습니다: ${jobId}`;

      log("INFO", `[cron] 수동 실행: user=${userId} job=${jobId}`);
      const personality = userConfig?.personality as Record<string, unknown> | undefined;
      const userName = (userConfig?.name as string) ?? userId;
      const profile = (userConfig?.profile as string) ?? "observer";
      const response = await executeWithClaude(job.prompt, profile, userId, personality, userName);
      // 응답 자체를 채널 메시지로 반환 → adapter가 그대로 전송
      return response;
    }
    default:
      return "알 수 없는 크론잡 명령입니다.";
  }
}

// --- 메시지 처리 파이프라인 ---
/**
 * 세션 스코프 키 결정.
 *   Slack 공용 채널 멘션 + 스레드 안 → "slack:thread:{chat_id}:{thread_ts}"
 *     → 스레드 참여자 전원이 같은 Claude 세션 맥락을 공유 (UX: 협업 대화)
 *   그 외 (DM, 채널 본문 단발 멘션, Telegram 등) → user_id
 *     → 기존과 동일한 개인 세션
 *
 * 개인 격리 축(프로필/메모리/personality/cwd 샌드박스)은 전부 user_id 기준 유지.
 * 이 함수가 바꾸는 건 "단기 대화 세션 UUID" 한 축뿐.
 */
function determineSessionScope(msg: IncomingMessage): string {
  const meta = msg.meta ?? {};
  const threadTs = meta.thread_ts as string | undefined;
  const isDm = meta.is_dm as boolean | undefined;

  if (msg.channel === "slack" && isDm === false && threadTs && msg.chat_id) {
    return `slack:thread:${msg.chat_id}:${threadTs}`;
  }
  return msg.user_id;
}

/**
 * 프로필의 session_ttl_hours와 user의 last_active_at를 비교해
 * TTL을 초과했으면 기존 claude 세션을 리셋합니다 (jsonl 삭제 + UUID null).
 * 이후 다음 getOrCreateClaudeSessionId() 호출이 새 UUID를 발급 → 새 세션으로 시작.
 * 페어링 안 된 유저는 no-op.
 */
function checkAndResetIfSessionExpired(userId: string): void {
  const config = loadUserConfig(userId);
  if (!config) return;

  const profileName = (config.profile as string) ?? "observer";
  const profile = getProfileConfig(profileName);
  const ttlHours = profile?.session_ttl_hours;
  if (!ttlHours || ttlHours <= 0) return; // 무제한

  const lastActive = config.last_active_at as string | undefined;
  if (!lastActive) return; // 첫 호출 — 비교 대상 없음

  const idleMs = Date.now() - new Date(lastActive).getTime();
  const ttlMs = ttlHours * 3600 * 1000;
  if (idleMs <= ttlMs) return;

  const idleHours = Math.round(idleMs / 3600 / 1000);
  log(
    "INFO",
    `[session] TTL 만료 자동 clear (user=${userId}, profile=${profileName}, idle=${idleHours}h > ttl=${ttlHours}h)`,
  );
  resetClaudeSessionId(userId);
}

async function handleMessage(incoming: IncomingMessage): Promise<string> {
  log("INFO", `수신: [${incoming.channel}] ${incoming.display_name}: ${incoming.message.slice(0, 80)}`);

  // TTL 자동 clear 체크 (touchUserActivity 이전에 — 지금 갱신되면 비교가 무의미해지므로)
  checkAndResetIfSessionExpired(incoming.user_id);

  // last_active_at 타임스탬프 갱신 (페어링 안 된 유저는 user 파일이 아직 없어 no-op)
  touchUserActivity(incoming.user_id);

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

  // 세션 스코프 결정 (스레드면 공유, 아니면 user 개인 세션)
  const sessionScopeKey = determineSessionScope(incoming);

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
      { sessionScopeKey },
    );

    return preMessage
      ? `${preMessage}\n\n---\n\n${truncate(response)}`
      : truncate(response);
  }

  // 3.5. /compact — 현재 세션을 요약 후 새 세션으로 이어가기
  //   Claude Code의 /compact는 non-interactive(-p) 모드에서 동작 안 하므로,
  //   (1) 요약 프롬프트로 Claude 한 번 호출 → 요약 문자열 획득
  //   (2) 기존 session_id 리셋 + jsonl 삭제
  //   (3) 요약을 pending_compact_summary로 저장 → 다음 메시지 처리 시 prepend
  if (routeResult.action === "compact") {
    const handle = getOrCreateClaudeSessionId(incoming.user_id);
    const hasPrev = handle.started || hasClaudeSessionJsonl(handle.session_id);

    if (!hasPrev) {
      return "요약할 이전 세션이 없습니다. 이미 새 세션 상태로 대기 중입니다.";
    }

    const summaryPrompt =
      "지금까지의 대화를 3-5줄로 한국어 plain text로 요약해줘. " +
      "현재 작업 주제, 주요 결정/합의 사항, 이어가야 할 맥락 중심. " +
      "마크다운 문법 사용 금지. 인사·메타설명 없이 요약 본문만.";

    log("INFO", `[compact] 시작 (user=${incoming.user_id}, session=${handle.session_id.slice(0, 8)})`);

    const summary = await executeWithClaude(
      summaryPrompt,
      profileName,
      incoming.user_id,
      personality,
      userName,
      undefined,
      { skipPendingSummary: true },
    );

    const { session_id: previousId } = resetClaudeSessionId(incoming.user_id);
    setPendingCompactSummary(incoming.user_id, summary);
    const next = getOrCreateClaudeSessionId(incoming.user_id);

    log(
      "INFO",
      `[compact] 완료 (user=${incoming.user_id}, prev=${previousId?.slice(0, 8) ?? "-"} → new=${next.session_id.slice(0, 8)})`,
    );

    return [
      "맥락을 요약해 새 세션으로 이어갑니다.",
      "",
      "[이번 세션 요약]",
      summary.trim(),
      "",
      `이전 세션: ${previousId?.slice(0, 8) ?? "-"}... (대화 기록 삭제됨)`,
      `새 세션: ${next.session_id.slice(0, 8)}...`,
      "",
      "다음 메시지부터 위 요약이 초기 맥락으로 주입되어 대화가 이어집니다.",
    ].join("\n");
  }

  // 4. 크론잡 커맨드 처리
  if (routeResult.response) {
    try {
      const cronCmd = JSON.parse(routeResult.response);
      if (cronCmd.action && cronCmd.action.startsWith("cron_")) {
        return await handleCronCommand(
          incoming.user_id,
          cronCmd.action,
          cronCmd.args ?? {},
          userConfig,
        );
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
    undefined,
    { sessionScopeKey },
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
import { startCronRunner } from "./cron-runner.js";
import { listCommands } from "../../../scripts/lib/commands.js";

// 채널 봇 메뉴 — scripts/lib/commands.ts의 채널 노출 명령에서 자동 생성.
// Telegram setMyCommands API는 "/" 프리픽스를 자동으로 붙이므로 name에서 제거.
const TELEGRAM_COMMANDS = listCommands({ channelOnly: true }).map((cmd) => ({
  command: cmd.name.replace(/^\//, ""),
  description: cmd.description,
}));

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
          // meta에는 플랫폼별 부가 정보 보존 (Slack의 thread_ts 등) —
          // executeWithClaude에서 세션 스코프 결정(스레드 공유 세션)에 사용
          meta: incoming.meta,
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

  // Cron runner 시작 — 모든 user의 cron_jobs를 1분 간격으로 체크
  const stopCronRunner = startCronRunner({
    adapters: activeAdapters,
    execute: async ({ prompt, userId, profile, userName, personality }) => {
      return executeWithClaude(prompt, profile, userId, personality, userName);
    },
    log,
  });

  log("INFO", "Jarvis Daemon 대기 중...");

  // 종료 시그널 핸들링
  const cleanup = async () => {
    log("INFO", "=== Jarvis Daemon 종료 ===");
    stopCronRunner();
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
