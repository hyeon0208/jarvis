import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openDatabase } from "./db.js";
import { DeclarativeMemoryStore } from "./declarative.js";
import { ProceduralMemoryStore } from "./procedural.js";
import { SessionStore } from "./session-search.js";
import { DreamingEngine } from "./dreaming.js";
import { UserProfileStore } from "./user-profile.js";

// --- DB 초기화 ---
const db = openDatabase();
const declarative = new DeclarativeMemoryStore(db);
const procedural = new ProceduralMemoryStore(db);
const sessions = new SessionStore(db);
const dreaming = new DreamingEngine(db);
const profiles = new UserProfileStore(db);

// Owner 프로파일 자동 생성
profiles.getOwner();

const server = new McpServer({
  name: "jarvis-memory",
  version: "0.1.0",
});

// ============================================================
// 선언적 메모리: 사실/선호도 저장 및 조회
// ============================================================

server.tool(
  "jarvis_memory_save",
  "메모리에 정보를 저장합니다 (선언적: 사실/선호도, 절차적: 스킬/패턴)",
  {
    type: z.enum(["declarative", "procedural"]).describe("메모리 유형"),
    key: z.string().describe("메모리 키 (예: user_preference, skill_deploy)"),
    content: z.string().describe("저장할 내용"),
    tags: z.array(z.string()).optional().describe("검색용 태그"),
    user_id: z.string().optional().describe("유저 ID (기본: owner)"),
  },
  async ({ type, key, content, tags, user_id }) => {
    if (type === "declarative") {
      const mem = declarative.save(key, content, tags ?? [], user_id ?? "owner");
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "saved",
              type: "declarative",
              id: mem.id,
              key: mem.key,
            }),
          },
        ],
      };
    }

    // procedural: key를 skill_name, content를 description으로 사용
    const skill = procedural.register(key, content, content, tags ?? []);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            status: "saved",
            type: "procedural",
            skill_name: skill.skill_name,
          }),
        },
      ],
    };
  },
);

server.tool(
  "jarvis_memory_recall",
  "메모리에서 정보를 검색합니다 (FTS5 전문 검색)",
  {
    query: z.string().describe("검색 쿼리"),
    type: z
      .enum(["declarative", "procedural", "all"])
      .optional()
      .describe("검색할 메모리 유형 (기본: all)"),
    limit: z.number().optional().describe("최대 결과 수 (기본: 5)"),
    user_id: z.string().optional().describe("유저 ID (기본: owner)"),
  },
  async ({ query, type: memType, limit: maxResults, user_id }) => {
    const searchType = memType ?? "all";
    const searchLimit = maxResults ?? 5;
    const results: Array<{ type: string; data: unknown }> = [];

    if (searchType === "declarative" || searchType === "all") {
      const declResults = declarative.search(query, user_id, searchLimit);
      for (const r of declResults) {
        results.push({ type: "declarative", data: r });
      }
    }

    if (searchType === "procedural" || searchType === "all") {
      const procResults = procedural.search(query, searchLimit);
      for (const r of procResults) {
        results.push({ type: "procedural", data: r });
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            query,
            total: results.length,
            results,
          }),
        },
      ],
    };
  },
);

server.tool(
  "jarvis_memory_list",
  "저장된 메모리 목록을 조회합니다",
  {
    type: z.enum(["declarative", "procedural"]).describe("메모리 유형"),
    user_id: z.string().optional().describe("유저 ID (기본: owner)"),
    limit: z.number().optional().describe("최대 결과 수 (기본: 20)"),
  },
  async ({ type, user_id, limit }) => {
    const maxItems = limit ?? 20;

    if (type === "declarative") {
      const items = declarative.listByUser(user_id ?? "owner", maxItems);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ type, total: items.length, items }),
          },
        ],
      };
    }

    const items = procedural.listAll(maxItems);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ type, total: items.length, items }),
        },
      ],
    };
  },
);

// ============================================================
// 세션 검색: 과거 대화 세션 전문 검색
// ============================================================

server.tool(
  "jarvis_session_save",
  "현재 세션의 메시지를 저장합니다 (세션 시작/메시지 추가/세션 종료)",
  {
    action: z.enum(["start", "message", "end"]).describe("액션"),
    session_id: z.string().describe("세션 ID"),
    role: z.string().optional().describe("메시지 역할 (user/assistant)"),
    content: z.string().optional().describe("메시지 내용 또는 세션 요약"),
    tool_count: z.number().optional().describe("도구 사용 횟수 (end 시)"),
    file_changes: z.number().optional().describe("파일 변경 수 (end 시)"),
    user_id: z.string().optional().describe("유저 ID"),
  },
  async ({ action, session_id, role, content, tool_count, file_changes, user_id }) => {
    if (action === "start") {
      sessions.startSession(session_id, user_id ?? "owner");
      return {
        content: [{ type: "text" as const, text: `세션 시작: ${session_id}` }],
      };
    }

    if (action === "message" && role && content) {
      sessions.addMessage(session_id, role, content);
      return {
        content: [{ type: "text" as const, text: "메시지 저장 완료" }],
      };
    }

    if (action === "end" && content) {
      sessions.endSession(session_id, content, tool_count ?? 0, file_changes ?? 0);
      return {
        content: [{ type: "text" as const, text: `세션 종료: ${session_id}` }],
      };
    }

    return {
      content: [{ type: "text" as const, text: "필수 파라미터가 누락되었습니다" }],
    };
  },
);

server.tool(
  "jarvis_session_search",
  "과거 대화 세션에서 관련 정보를 검색합니다 (FTS5)",
  {
    query: z.string().describe("검색 쿼리"),
    limit: z.number().optional().describe("최대 결과 수 (기본: 3)"),
  },
  async ({ query, limit }) => {
    const results = sessions.search(query, limit ?? 3);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            query,
            total: results.length,
            results,
          }),
        },
      ],
    };
  },
);

// ============================================================
// Dreaming: 비동기 메모리 정리/통합
// ============================================================

server.tool(
  "jarvis_memory_dream",
  "메모리 Dreaming을 실행합니다 (중복 병합, 오래된 사실 아카이브)",
  {
    user_id: z.string().optional().describe("유저 ID (기본: owner)"),
    stale_days: z.number().optional().describe("오래된 기준 일수 (기본: 90)"),
  },
  async ({ user_id, stale_days }) => {
    const report = dreaming.dream(user_id ?? "owner", stale_days ?? 90);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(report),
        },
      ],
    };
  },
);

server.tool(
  "jarvis_dream_history",
  "Dreaming 실행 히스토리를 조회합니다",
  {
    limit: z.number().optional().describe("최대 결과 수 (기본: 10)"),
  },
  async ({ limit }) => {
    const history = dreaming.history(limit ?? 10);
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(history) },
      ],
    };
  },
);

// ============================================================
// 사용자 프로파일
// ============================================================

server.tool(
  "jarvis_user_profile",
  "사용자 프로파일을 관리합니다 (조회/생성/업데이트/목록)",
  {
    action: z
      .enum(["get", "create", "update", "list", "delete"])
      .describe("액션"),
    user_id: z.string().optional().describe("유저 ID"),
    data: z
      .record(z.unknown())
      .optional()
      .describe("생성/업데이트 데이터"),
  },
  async ({ action, user_id, data }) => {
    if (action === "get") {
      const profile = user_id ? profiles.get(user_id) : profiles.getOwner();
      return {
        content: [
          {
            type: "text" as const,
            text: profile ? JSON.stringify(profile) : "프로파일을 찾을 수 없습니다",
          },
        ],
      };
    }

    if (action === "create" && user_id && data) {
      const profile = profiles.create(
        user_id,
        (data.channel as string) ?? "unknown",
        data.name as string | undefined,
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(profile) }],
      };
    }

    if (action === "update" && user_id && data) {
      const profile = profiles.update(user_id, data as Record<string, unknown>);
      return {
        content: [
          {
            type: "text" as const,
            text: profile ? JSON.stringify(profile) : "프로파일을 찾을 수 없습니다",
          },
        ],
      };
    }

    if (action === "list") {
      const all = profiles.listAll();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(all) }],
      };
    }

    if (action === "delete" && user_id) {
      profiles.delete(user_id);
      return {
        content: [{ type: "text" as const, text: `삭제 완료: ${user_id}` }],
      };
    }

    return {
      content: [{ type: "text" as const, text: "필수 파라미터가 누락되었습니다" }],
    };
  },
);

// ============================================================
// 통계
// ============================================================

server.tool(
  "jarvis_memory_stats",
  "메모리 시스템 전체 통계를 조회합니다",
  {},
  async () => {
    const stats = {
      declarative_memories: declarative.count(),
      procedural_memories: procedural.count(),
      sessions: sessions.sessionCount(),
      session_messages: sessions.messageCount(),
      paired_users: profiles.pairedCount(),
      total_users: profiles.listAll().length,
      dreaming_history: dreaming.history(1),
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(stats, null, 2) }],
    };
  },
);

// ============================================================
// 서버 시작
// ============================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Jarvis Memory Server 시작됨");
}

main().catch(console.error);
