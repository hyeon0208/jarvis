import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "jarvis-memory",
  version: "0.1.0",
});

// --- 선언적 메모리: 사실/선호도 저장 및 조회 ---

server.tool(
  "jarvis_memory_save",
  "메모리에 정보를 저장합니다 (선언적: 사실/선호도, 절차적: 스킬/패턴)",
  {
    type: z.enum(["declarative", "procedural"]).describe("메모리 유형"),
    key: z.string().describe("메모리 키 (예: user_preference, skill_deploy)"),
    content: z.string().describe("저장할 내용"),
    tags: z.array(z.string()).optional().describe("검색용 태그"),
  },
  async ({ type, key, content, tags }) => {
    // TODO: SQLite에 저장
    return {
      content: [
        {
          type: "text" as const,
          text: `메모리 저장 완료: [${type}] ${key}`,
        },
      ],
    };
  },
);

server.tool(
  "jarvis_memory_recall",
  "메모리에서 정보를 검색합니다 (키워드/유사도 기반)",
  {
    query: z.string().describe("검색 쿼리"),
    type: z
      .enum(["declarative", "procedural", "all"])
      .optional()
      .describe("검색할 메모리 유형"),
    limit: z.number().optional().default(5).describe("최대 결과 수"),
  },
  async ({ query, type, limit }) => {
    // TODO: SQLite FTS5 검색
    return {
      content: [
        {
          type: "text" as const,
          text: `메모리 검색 결과 (${query}): 아직 구현 전입니다.`,
        },
      ],
    };
  },
);

// --- 세션 검색: 과거 세션 전문 검색 ---

server.tool(
  "jarvis_session_search",
  "과거 대화 세션에서 관련 정보를 검색합니다 (FTS5)",
  {
    query: z.string().describe("검색 쿼리"),
    limit: z.number().optional().default(3).describe("최대 세션 수"),
  },
  async ({ query, limit }) => {
    // TODO: 세션 DB FTS5 검색 + LLM 요약
    return {
      content: [
        {
          type: "text" as const,
          text: `세션 검색 결과 (${query}): 아직 구현 전입니다.`,
        },
      ],
    };
  },
);

// --- Dreaming: 비동기 메모리 정리 ---

server.tool(
  "jarvis_memory_dream",
  "메모리 Dreaming을 실행합니다 (중복 제거, 통합, 오래된 사실 아카이브)",
  {},
  async () => {
    // TODO: 메모리 정리 로직
    return {
      content: [
        {
          type: "text" as const,
          text: "Dreaming 완료: 아직 구현 전입니다.",
        },
      ],
    };
  },
);

// --- 사용자 프로파일 ---

server.tool(
  "jarvis_user_profile",
  "사용자 프로파일을 조회하거나 업데이트합니다",
  {
    action: z.enum(["get", "update"]).describe("조회 또는 업데이트"),
    user_id: z.string().optional().describe("유저 ID (비어있으면 Owner)"),
    data: z
      .record(z.unknown())
      .optional()
      .describe("업데이트할 데이터 (action=update 시)"),
  },
  async ({ action, user_id, data }) => {
    // TODO: 프로파일 관리
    return {
      content: [
        {
          type: "text" as const,
          text: `프로파일 ${action}: 아직 구현 전입니다.`,
        },
      ],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Jarvis Memory Server 시작됨");
}

main().catch(console.error);
