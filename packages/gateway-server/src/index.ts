import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "jarvis-gateway",
  version: "0.1.0",
});

// --- 채널 메시지 전송 ---

server.tool(
  "jarvis_gateway_send",
  "특정 채널의 유저에게 메시지를 전송합니다",
  {
    channel: z
      .enum(["telegram", "discord", "slack"])
      .describe("대상 채널"),
    user_id: z.string().describe("유저 ID"),
    message: z.string().describe("전송할 메시지"),
  },
  async ({ channel, user_id, message }) => {
    // TODO: 채널 어댑터를 통해 전송
    return {
      content: [
        {
          type: "text" as const,
          text: `메시지 전송 완료: [${channel}] ${user_id}`,
        },
      ],
    };
  },
);

// --- 브로드캐스트 ---

server.tool(
  "jarvis_gateway_broadcast",
  "모든 등록된 유저에게 메시지를 전송합니다",
  {
    message: z.string().describe("전송할 메시지"),
    profile: z
      .string()
      .optional()
      .describe("특정 프로필의 유저만 대상 (비어있으면 전체)"),
  },
  async ({ message, profile }) => {
    // TODO: 전체 유저 또는 프로필별 브로드캐스트
    return {
      content: [
        {
          type: "text" as const,
          text: `브로드캐스트 완료: ${profile ?? "전체"}`,
        },
      ],
    };
  },
);

// --- 채널 상태 조회 ---

server.tool(
  "jarvis_gateway_status",
  "채널 연결 상태를 조회합니다",
  {},
  async () => {
    // TODO: 각 채널 어댑터의 연결 상태
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            telegram: { connected: false, users: 0 },
            discord: { connected: false, users: 0 },
            slack: { connected: false, users: 0 },
          }),
        },
      ],
    };
  },
);

// --- DM 페어링 관리 ---

server.tool(
  "jarvis_gateway_pair",
  "유저 DM 페어링을 관리합니다 (등록/승인/거부/목록)",
  {
    action: z
      .enum(["list", "approve", "reject", "generate_code"])
      .describe("페어링 액션"),
    user_id: z.string().optional().describe("대상 유저 ID"),
  },
  async ({ action, user_id }) => {
    // TODO: 페어링 로직
    return {
      content: [
        {
          type: "text" as const,
          text: `페어링 ${action}: 아직 구현 전입니다.`,
        },
      ],
    };
  },
);

// --- 크론잡 관리 ---

server.tool(
  "jarvis_cron_manage",
  "유저의 크론잡을 관리합니다 (등록/목록/삭제/토글)",
  {
    action: z
      .enum(["add", "list", "delete", "toggle"])
      .describe("크론잡 액션"),
    user_id: z.string().describe("유저 ID"),
    job_id: z.string().optional().describe("크론잡 ID (delete/toggle 시)"),
    schedule: z
      .string()
      .optional()
      .describe("크론 표현식 또는 자연어 (add 시)"),
    prompt: z.string().optional().describe("실행할 프롬프트 (add 시)"),
  },
  async ({ action, user_id, job_id, schedule, prompt }) => {
    // TODO: 크론잡 관리 로직
    return {
      content: [
        {
          type: "text" as const,
          text: `크론잡 ${action}: 아직 구현 전입니다.`,
        },
      ],
    };
  },
);

// --- 프로필 관리 ---

server.tool(
  "jarvis_profile_manage",
  "유저 프로필을 관리합니다 (조회/변경/목록)",
  {
    action: z
      .enum(["list_profiles", "get_user", "set_user_profile", "set_personality"])
      .describe("프로필 액션"),
    user_id: z.string().optional().describe("유저 ID"),
    profile: z.string().optional().describe("프로필 이름 (set 시)"),
    personality: z
      .record(z.unknown())
      .optional()
      .describe("개인화 설정 (set_personality 시)"),
  },
  async ({ action, user_id, profile, personality }) => {
    // TODO: 프로필 관리 로직
    return {
      content: [
        {
          type: "text" as const,
          text: `프로필 ${action}: 아직 구현 전입니다.`,
        },
      ],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Jarvis Gateway Server 시작됨");
}

main().catch(console.error);
