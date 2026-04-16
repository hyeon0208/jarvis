import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  isUserPaired,
  approvePairing,
  listPendingPairings,
  rejectPairing,
  loadUserConfig,
  updateUserConfig,
} from "./auth.js";
import { listProfiles, getProfile } from "./profiles.js";
import { routeMessage, type IncomingMessage } from "./router.js";
import { buildSandboxConfig, buildDockerCommand } from "./sandbox.js";
import { addCronJob, listCronJobs, deleteCronJob, toggleCronJob } from "./cron.js";
import { ensureWorktree, removeWorktree, listWorktrees } from "./worktree.js";

const server = new McpServer({
  name: "jarvis-gateway",
  version: "0.1.0",
});

// ============================================================
// 메시지 라우팅
// ============================================================

server.tool(
  "jarvis_gateway_route",
  "채널에서 받은 메시지를 라우팅합니다 (인증/권한 체크 → 응답 또는 실행 지시)",
  {
    channel: z.enum(["telegram", "discord", "slack"]).describe("수신 채널"),
    user_id: z.string().describe("발신자 ID (채널:숫자 형식)"),
    display_name: z.string().describe("발신자 표시 이름"),
    message: z.string().describe("메시지 내용"),
    message_id: z.string().optional().describe("메시지 ID"),
    chat_id: z.string().optional().describe("채팅방 ID"),
  },
  async ({ channel, user_id, display_name, message, message_id, chat_id }) => {
    const incoming: IncomingMessage = {
      channel,
      user_id,
      display_name,
      message,
      message_id,
      chat_id,
    };

    const result = routeMessage(incoming);

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result) },
      ],
    };
  },
);

// ============================================================
// 메시지 전송 (채널 어댑터 호출용)
// ============================================================

server.tool(
  "jarvis_gateway_send",
  "특정 채널의 유저에게 메시지를 전송합니다",
  {
    channel: z.enum(["telegram", "discord", "slack"]).describe("대상 채널"),
    user_id: z.string().describe("유저 ID"),
    message: z.string().describe("전송할 메시지"),
    chat_id: z.string().optional().describe("채팅방 ID (Telegram)"),
  },
  async ({ channel, user_id, message, chat_id }) => {
    // 채널 어댑터를 통해 전송 (현재는 응답 데이터 반환)
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            action: "send",
            channel,
            user_id,
            chat_id,
            message,
            status: "queued",
          }),
        },
      ],
    };
  },
);

// ============================================================
// DM 페어링 관리
// ============================================================

server.tool(
  "jarvis_gateway_pair",
  "유저 DM 페어링을 관리합니다 (목록/승인/거부)",
  {
    action: z.enum(["list", "approve", "reject"]).describe("페어링 액션"),
    code: z.string().optional().describe("페어링 코드 (approve 시)"),
    user_id: z.string().optional().describe("유저 ID (reject 시)"),
    profile: z.string().optional().describe("할당할 프로필 (approve 시, 기본: observer)"),
  },
  async ({ action, code, user_id, profile }) => {
    if (action === "list") {
      const pending = listPendingPairings();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ pending_count: pending.length, pairings: pending }),
          },
        ],
      };
    }

    if (action === "approve" && code) {
      const result = approvePairing(code, profile ?? "observer");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    }

    if (action === "reject" && user_id) {
      const rejected = rejectPairing(user_id);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ success: rejected }),
          },
        ],
      };
    }

    return {
      content: [{ type: "text" as const, text: "필수 파라미터가 누락되었습니다" }],
    };
  },
);

// ============================================================
// 프로필 관리
// ============================================================

server.tool(
  "jarvis_profile_manage",
  "프로필 및 유저 설정을 관리합니다",
  {
    action: z
      .enum(["list_profiles", "get_user", "set_user_profile", "set_personality"])
      .describe("액션"),
    user_id: z.string().optional().describe("유저 ID"),
    profile: z.string().optional().describe("프로필 이름"),
    personality: z
      .record(z.unknown())
      .optional()
      .describe("개인화 설정"),
  },
  async ({ action, user_id, profile, personality }) => {
    if (action === "list_profiles") {
      const profiles = listProfiles();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(profiles) }],
      };
    }

    if (action === "get_user" && user_id) {
      const config = loadUserConfig(user_id);
      return {
        content: [
          {
            type: "text" as const,
            text: config ? JSON.stringify(config) : "유저를 찾을 수 없습니다",
          },
        ],
      };
    }

    if (action === "set_user_profile" && user_id && profile) {
      const success = updateUserConfig(user_id, { profile });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ success, user_id, profile }),
          },
        ],
      };
    }

    if (action === "set_personality" && user_id && personality) {
      const current = loadUserConfig(user_id);
      if (!current) {
        return {
          content: [{ type: "text" as const, text: "유저를 찾을 수 없습니다" }],
        };
      }
      const merged = {
        ...(current.personality as Record<string, unknown>),
        ...personality,
      };
      const success = updateUserConfig(user_id, { personality: merged });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ success, personality: merged }),
          },
        ],
      };
    }

    return {
      content: [{ type: "text" as const, text: "필수 파라미터가 누락되었습니다" }],
    };
  },
);

// ============================================================
// 크론잡 관리
// ============================================================

server.tool(
  "jarvis_cron_manage",
  "유저의 크론잡을 관리합니다 (등록/목록/삭제/토글)",
  {
    action: z.enum(["add", "list", "delete", "toggle"]).describe("크론잡 액션"),
    user_id: z.string().describe("유저 ID"),
    prompt: z.string().optional().describe("자연어 스케줄 + 프롬프트 (add 시)"),
    job_id: z.string().optional().describe("크론잡 ID (delete/toggle 시)"),
  },
  async ({ action, user_id, prompt, job_id }) => {
    if (action === "add" && prompt) {
      const result = addCronJob(user_id, prompt);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    }

    if (action === "list") {
      const jobs = listCronJobs(user_id);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ total: jobs.length, jobs }),
          },
        ],
      };
    }

    if (action === "delete" && job_id) {
      const success = deleteCronJob(user_id, job_id);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success }) }],
      };
    }

    if (action === "toggle" && job_id) {
      const result = toggleCronJob(user_id, job_id);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    }

    return {
      content: [{ type: "text" as const, text: "필수 파라미터가 누락되었습니다" }],
    };
  },
);

// ============================================================
// Worktree 관리
// ============================================================

server.tool(
  "jarvis_worktree_manage",
  "멤버별 git worktree를 관리합니다 (목록/생성/삭제)",
  {
    action: z.enum(["list", "ensure", "remove"]).describe("액션"),
    project_dir: z.string().describe("프로젝트 디렉토리 경로"),
    user_id: z.string().optional().describe("유저 ID (ensure/remove 시)"),
  },
  async ({ action, project_dir, user_id }) => {
    if (action === "list") {
      const wts = listWorktrees(project_dir);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ total: wts.length, worktrees: wts }),
          },
        ],
      };
    }

    if (action === "ensure" && user_id) {
      const wt = ensureWorktree(project_dir, user_id);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(wt) }],
      };
    }

    if (action === "remove" && user_id) {
      const removed = removeWorktree(project_dir, user_id);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ success: removed }) },
        ],
      };
    }

    return {
      content: [{ type: "text" as const, text: "필수 파라미터가 누락되었습니다" }],
    };
  },
);

// ============================================================
// 샌드박스 설정 조회
// ============================================================

server.tool(
  "jarvis_sandbox_config",
  "유저의 샌드박스 설정을 조회합니다 (Docker 실행 옵션)",
  {
    user_id: z.string().describe("유저 ID"),
    project_dir: z.string().optional().describe("프로젝트 디렉토리"),
    command: z.string().optional().describe("실행할 명령 (Docker 명령 생성용)"),
  },
  async ({ user_id, project_dir, command }) => {
    const config = loadUserConfig(user_id);
    if (!config) {
      return {
        content: [{ type: "text" as const, text: "유저를 찾을 수 없습니다" }],
      };
    }

    const profileName = (config.profile as string) ?? "observer";
    const sandboxConfig = buildSandboxConfig(profileName, project_dir);

    const result: Record<string, unknown> = { sandbox: sandboxConfig };

    if (command) {
      result.docker_command = buildDockerCommand(sandboxConfig, command);
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

// ============================================================
// 채널 상태 조회
// ============================================================

server.tool(
  "jarvis_gateway_status",
  "게이트웨이 상태를 조회합니다 (채널 연결, 페어링된 유저 수)",
  {},
  async () => {
    const pending = listPendingPairings();
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            version: "0.1.0",
            channels: {
              telegram: { status: "configured" },
              discord: { status: "pending" },
              slack: { status: "pending" },
            },
            pending_pairings: pending.length,
          }),
        },
      ],
    };
  },
);

// ============================================================
// 서버 시작
// ============================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Jarvis Gateway Server 시작됨");
}

main().catch(console.error);
