import {
  isUserPaired,
  createPairingRequest,
  loadUserConfig,
} from "./auth.js";
import { getProfile, checkPermission } from "./profiles.js";

export interface IncomingMessage {
  channel: "telegram" | "discord" | "slack";
  user_id: string;
  display_name: string;
  message: string;
  message_id?: string;
  chat_id?: string;
  is_command?: boolean;
}

export interface RouteResult {
  action: "respond" | "pairing_required" | "permission_denied" | "execute";
  response?: string;
  user_config?: Record<string, unknown>;
  profile?: string;
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
  return null;
}

/** 시스템 커맨드 파싱 */
function parseSystemCommand(message: string): string | null {
  const trimmed = message.trim();
  const commands = ["/help", "/status", "/profile", "/personality"];
  for (const cmd of commands) {
    if (trimmed === cmd || trimmed.startsWith(cmd + " ")) return cmd;
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
        `페어링 코드: **${request.code}**\n\n` +
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

  // 3. 시스템 커맨드 처리
  const sysCmd = parseSystemCommand(msg.message);
  if (sysCmd) {
    return handleSystemCommand(sysCmd, msg, userConfig, profileName);
  }

  // 4. 크론잡 커맨드 처리
  const cronCmd = parseCronCommand(msg.message);
  if (cronCmd) {
    if (!checkPermission(profileName, "cron")) {
      return {
        action: "permission_denied",
        response: "크론잡 권한이 없습니다.",
      };
    }
    return {
      action: "execute",
      response: JSON.stringify(cronCmd),
      user_config: userConfig,
      profile: profileName,
    };
  }

  // 5. 일반 메시지 → 실행
  return {
    action: "execute",
    user_config: userConfig,
    profile: profileName,
  };
}

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
          "Jarvis 사용 가능한 명령:",
          "",
          "/help — 이 도움말",
          "/status — Jarvis 상태",
          "/profile — 내 프로필 조회",
          "/personality — 개인화 설정",
          "/cron add {설명} — 크론잡 등록",
          "/cron list — 크론잡 목록",
          "/cron delete {id} — 크론잡 삭제",
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
          `샌드박스: ${profile?.sandbox ? "O" : "X"}`,
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
              `이모지: ${personality.emoji ? "O" : "X"}`,
              `호칭: ${personality.nickname}`,
            ].join("\n")
          : "개인화 설정이 없습니다.",
      };
    }

    default:
      return { action: "respond", response: "알 수 없는 명령입니다." };
  }
}
