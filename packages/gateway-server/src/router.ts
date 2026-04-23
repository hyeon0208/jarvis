import {
  isUserPaired,
  createPairingRequest,
  loadUserConfig,
} from "./auth.js";
import { getProfile, checkPermission } from "./profiles.js";
import { resetClaudeSessionId, getOrCreateClaudeSessionId } from "./auth.js";
import {
  getWorkflow,
  startWorkflow,
  selectProject,
  selectMode,
  finishWorkflow,
  cancelWorkflow,
  getWorkflowStatus,
} from "./workflow.js";

export interface IncomingMessage {
  channel: "telegram" | "discord" | "slack";
  user_id: string;
  display_name: string;
  message: string;
  message_id?: string;
  chat_id?: string;
  /**
   * 채널 어댑터가 전달한 플랫폼별 부가 정보.
   * Slack: { is_dm: boolean; thread_ts?: string } — thread_ts가 있으면 세션을
   * 해당 스레드 단위로 공유 (스레드 참여자 전원이 같은 Claude 세션 맥락을 공유).
   */
  meta?: Record<string, unknown>;
}

export interface RouteResult {
  action:
    | "respond"
    | "pairing_required"
    | "permission_denied"
    | "execute"
    | "dev_execute"
    | "compact";
  response?: string;
  user_config?: Record<string, unknown>;
  profile?: string;
  workDir?: string;  // dev_execute 시 작업 디렉토리
  task?: string;     // dev_execute 시 작업 내용
}

/** 크론잡 커맨드 파싱 */
function parseCronCommand(message: string): {
  action: string;
  args: Record<string, string>;
} | null {
  const trimmed = message.trim();

  if (trimmed.startsWith("/cron add ")) {
    return { action: "cron_add", args: { prompt: trimmed.slice(10) } };
  }
  if (trimmed === "/cron list") {
    return { action: "cron_list", args: {} };
  }
  if (trimmed.startsWith("/cron delete ")) {
    return { action: "cron_delete", args: { job_id: trimmed.slice(13) } };
  }
  if (trimmed.startsWith("/cron pause ")) {
    return { action: "cron_pause", args: { job_id: trimmed.slice(12) } };
  }
  if (trimmed.startsWith("/cron run ")) {
    return { action: "cron_run", args: { job_id: trimmed.slice(10) } };
  }
  return null;
}

/** 시스템 커맨드 파싱 */
function parseSystemCommand(message: string): string | null {
  const trimmed = message.trim();
  // /clear와 /reset은 동일 동작 (둘 다 허용)
  const commands = [
    "/help",
    "/status",
    "/profile",
    "/personality",
    "/clear",
    "/reset",
    "/compact",
  ];
  for (const cmd of commands) {
    if (trimmed === cmd || trimmed.startsWith(cmd + " ")) return cmd;
  }
  return null;
}

/** /dev 커맨드 파싱 */
function parseDevCommand(message: string): {
  subcommand: string;
  args: string;
} | null {
  const trimmed = message.trim();

  if (trimmed.startsWith("/dev ")) {
    const rest = trimmed.slice(5).trim();

    if (rest === "status") return { subcommand: "status", args: "" };
    if (rest === "cancel") return { subcommand: "cancel", args: "" };
    if (rest === "done" || rest === "pr") return { subcommand: "done", args: "" };

    // /dev {작업 내용}
    return { subcommand: "start", args: rest };
  }

  if (trimmed === "/dev") {
    return { subcommand: "help", args: "" };
  }

  return null;
}

/** 메시지 라우팅 */
export function routeMessage(msg: IncomingMessage): RouteResult {
  // 1. 페어링 확인
  if (!isUserPaired(msg.user_id)) {
    const request = createPairingRequest(
      msg.user_id,
      msg.channel,
      msg.display_name,
    );
    return {
      action: "pairing_required",
      response:
        `안녕하세요 ${msg.display_name}님! Jarvis를 사용하려면 페어링이 필요합니다.\n\n` +
        `페어링 코드: ${request.code}\n\n` +
        `관리자에게 이 코드를 전달하세요. 코드는 24시간 후 만료됩니다.`,
    };
  }

  // 2. 유저 설정 로드
  const userConfig = loadUserConfig(msg.user_id);
  if (!userConfig) {
    return {
      action: "permission_denied",
      response: "프로파일 설정을 찾을 수 없습니다. 관리자에게 문의하세요.",
    };
  }

  const profileName = (userConfig.profile as string) ?? "observer";

  // 3. 워크플로우 진행 중인지 확인
  const workflow = getWorkflow(msg.user_id);
  if (workflow && workflow.state !== "idle" && workflow.state !== "done") {
    return handleWorkflowInput(msg, profileName, userConfig, workflow);
  }

  // 4. /dev 커맨드
  const devCmd = parseDevCommand(msg.message);
  if (devCmd) {
    return handleDevCommand(msg, profileName, userConfig, devCmd);
  }

  // 5. 시스템 커맨드
  const sysCmd = parseSystemCommand(msg.message);
  if (sysCmd) {
    return handleSystemCommand(sysCmd, msg, userConfig, profileName);
  }

  // 6. 크론잡 커맨드
  const cronCmd = parseCronCommand(msg.message);
  if (cronCmd) {
    if (!checkPermission(profileName, "cron")) {
      return { action: "permission_denied", response: "크론잡 권한이 없습니다." };
    }
    return {
      action: "execute",
      response: JSON.stringify(cronCmd),
      user_config: userConfig,
      profile: profileName,
    };
  }

  // 7. 일반 메시지 → 실행
  return {
    action: "execute",
    user_config: userConfig,
    profile: profileName,
  };
}

/** 워크플로우 진행 중 입력 처리 */
function handleWorkflowInput(
  msg: IncomingMessage,
  profileName: string,
  userConfig: Record<string, unknown>,
  workflow: { state: string },
): RouteResult {
  const trimmed = msg.message.trim().toLowerCase();

  // 취소 커맨드 (오타 허용: cancel, cancle, abort, stop, quit, x)
  const cancelCommands = [
    "/dev cancel", "/dev cancle", "/dev abort", "/dev stop",
    "/dev quit", "/dev x", "/cancel", "/cancle", "/abort", "/stop",
  ];
  if (cancelCommands.includes(trimmed)) {
    return { action: "respond", response: cancelWorkflow(msg.user_id) };
  }

  // 워크플로우 중 /dev로 시작하는 다른 커맨드
  if (trimmed.startsWith("/dev ") || trimmed === "/dev") {
    if (trimmed === "/dev status") {
      return { action: "respond", response: "워크플로우 진행 중입니다. /dev cancel로 취소할 수 있습니다." };
    }
    if (trimmed === "/dev done" || trimmed === "/dev pr") {
      // working 상태일 때만 의미있음, 아니면 안내
      if (workflow.state !== "working") {
        return { action: "respond", response: "아직 작업이 시작되지 않았습니다. 먼저 1 또는 2를 선택하세요." };
      }
      return { action: "respond", response: finishWorkflow(msg.user_id) };
    }
    return {
      action: "respond",
      response: "워크플로우 진행 중에는 /dev cancel만 사용 가능합니다.",
    };
  }

  if (workflow.state === "awaiting_project") {
    return {
      action: "respond",
      response: selectProject(msg.user_id, profileName, msg.message),
    };
  }

  if (workflow.state === "awaiting_mode") {
    const result = selectMode(msg.user_id, msg.message);

    if (!result.readyToWork) {
      return { action: "respond", response: result.response };
    }

    // 작업 시작! dev_execute 액션으로 데몬에게 전달
    return {
      action: "dev_execute",
      response: result.response,
      user_config: userConfig,
      profile: profileName,
      workDir: result.workDir,
      task: result.task,
    };
  }

  if (workflow.state === "working") {
    // /dev done으로 완료 요청
    if (msg.message.trim() === "/dev done" || msg.message.trim() === "/dev pr") {
      return { action: "respond", response: finishWorkflow(msg.user_id) };
    }

    // 작업 중 추가 요청 → 같은 worktree에서 실행
    const currentWorkflow = getWorkflow(msg.user_id);
    return {
      action: "dev_execute",
      user_config: userConfig,
      profile: profileName,
      workDir: currentWorkflow?.worktree_path ?? undefined,
      task: msg.message,
    };
  }

  return { action: "respond", response: "알 수 없는 워크플로우 상태입니다." };
}

/** /dev 커맨드 처리 */
function handleDevCommand(
  msg: IncomingMessage,
  profileName: string,
  userConfig: Record<string, unknown>,
  cmd: { subcommand: string; args: string },
): RouteResult {
  if (!checkPermission(profileName, "write")) {
    return {
      action: "permission_denied",
      response: "개발 워크플로우는 write 권한이 필요합니다.",
    };
  }

  switch (cmd.subcommand) {
    case "start":
      return {
        action: "respond",
        response: startWorkflow(msg.user_id, profileName, cmd.args),
      };

    case "status":
      return { action: "respond", response: getWorkflowStatus(msg.user_id) };

    case "cancel":
      return { action: "respond", response: cancelWorkflow(msg.user_id) };

    case "done":
      return { action: "respond", response: finishWorkflow(msg.user_id) };

    case "help":
      return {
        action: "respond",
        response: [
          "개발 워크플로우 명령:",
          "",
          "/dev {작업 내용}  — 개발 시작",
          "/dev status      — 진행 상태",
          "/dev done        — 작업 완료 → PR 생성",
          "/dev cancel      — 워크플로우 취소",
          "",
          "예: /dev UserService에 이메일 검증 추가",
        ].join("\n"),
      };

    default:
      return { action: "respond", response: "/dev help 로 사용법을 확인하세요." };
  }
}

/** 시스템 커맨드 처리 */
function handleSystemCommand(
  cmd: string,
  msg: IncomingMessage,
  userConfig: Record<string, unknown>,
  profileName: string,
): RouteResult {
  switch (cmd) {
    case "/help":
      return {
        action: "respond",
        response: [
          "Jarvis 명령:",
          "",
          "/dev {작업}     — 개발 워크플로우 시작",
          "/dev status     — 개발 진행 상태",
          "/dev done       — PR 생성",
          "/dev cancel     — 개발 취소",
          "/cron add ...   — 크론잡 등록",
          "/cron list      — 크론잡 목록",
          "/status         — Jarvis 상태",
          "/profile        — 내 프로필",
          "/personality    — 개인화 설정 조회",
          "/clear          — 대화 컨텍스트 초기화 (메모리는 유지)",
          "/compact        — 맥락 요약 후 새 세션으로 이어감",
          "",
          "그 외 메시지는 AI 질문으로 처리됩니다.",
        ].join("\n"),
      };

    case "/status":
      return {
        action: "respond",
        response: `Jarvis 상태: 온라인\n프로필: ${profileName}\n채널: ${msg.channel}`,
      };

    case "/profile": {
      const profile = getProfile(profileName);
      return {
        action: "respond",
        response: [
          `프로필: ${profileName}`,
          `설명: ${profile?.description ?? "알 수 없음"}`,
          `읽기: ${profile?.permissions.read ? "O" : "X"}`,
          `쓰기: ${profile?.permissions.write ? "O" : "X"}`,
          `실행: ${profile?.permissions.execute ? "O" : "X"}`,
          `크론: ${profile?.permissions.cron ? "O" : "X"}`,
        ].join("\n"),
      };
    }

    case "/personality": {
      const personality = userConfig.personality as Record<string, unknown> | undefined;
      return {
        action: "respond",
        response: personality
          ? [
              "현재 개인화 설정:",
              `톤: ${personality.tone}`,
              `언어: ${personality.language}`,
              `상세도: ${personality.verbosity}`,
              `호칭: ${personality.nickname}`,
            ].join("\n")
          : "개인화 설정이 없습니다.",
      };
    }

    case "/clear":
    case "/reset": {
      // 1) 기존 세션 초기화 + jsonl 파일 실제 삭제
      const { session_id: previousId, deleted_path } = resetClaudeSessionId(msg.user_id);
      // 2) 즉시 새 UUID 발급 (다음 메시지가 바로 새 세션으로 시작)
      const next = getOrCreateClaudeSessionId(msg.user_id);

      const previousLine = previousId
        ? `이전 세션: ${previousId.slice(0, 8)}... ${deleted_path ? "(대화 기록 삭제됨)" : "(기록 파일 못 찾음)"}`
        : "이전 세션: 없음";

      return {
        action: "respond",
        response: [
          "대화 컨텍스트가 초기화되었습니다.",
          previousLine,
          `새 세션: ${next.session_id.slice(0, 8)}...`,
          "",
          "지금부터 보내는 메시지는 처음 보는 대화로 처리됩니다.",
          "(jarvis_memory에 저장된 장기 기억 · personality · cron_jobs는 유지됩니다)",
        ].join("\n"),
      };
    }

    case "/compact":
      // 실제 처리는 daemon에서 — 요약용 Claude 호출이 필요하므로 router에서는 못 함
      return {
        action: "compact",
        user_config: userConfig,
        profile: profileName,
      };

    default:
      return { action: "respond", response: "알 수 없는 명령입니다." };
  }
}
