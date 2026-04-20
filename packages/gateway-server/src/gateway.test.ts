import { describe, test, expect } from "bun:test";

describe("Profiles (YAML)", () => {
  test("Given profiles.yml When 로드 Then owner와 observer 존재", async () => {
    const { listProfiles } = await import("./profiles.js");
    const profiles = listProfiles();

    const names = profiles.map((p) => p.name);
    expect(names).toContain("owner");
    expect(names).toContain("observer");
  });

  test("Given owner 프로필 When 권한 체크 Then 모든 권한 허용", async () => {
    const { checkPermission } = await import("./profiles.js");

    expect(checkPermission("owner", "read")).toBe(true);
    expect(checkPermission("owner", "write")).toBe(true);
    expect(checkPermission("owner", "execute")).toBe(true);
    expect(checkPermission("owner", "cron")).toBe(true);
  });

  test("Given observer 프로필 When 권한 체크 Then 읽기/쓰기/실행 모두 거부 (질문/검색만)", async () => {
    const { checkPermission } = await import("./profiles.js");

    // observer는 정의상 "질문/검색만" — 로컬 파일 read 권한도 없음
    // (WebSearch/WebFetch + 메모리 MCP만 허용)
    expect(checkPermission("observer", "read")).toBe(false);
    expect(checkPermission("observer", "write")).toBe(false);
    expect(checkPermission("observer", "execute")).toBe(false);
  });

  test("Given 존재하지 않는 프로필 When 권한 체크 Then 거부", async () => {
    const { checkPermission } = await import("./profiles.js");
    expect(checkPermission("nonexistent", "read")).toBe(false);
  });
});

describe("Sandbox Config", () => {
  test("Given owner 프로필 When 샌드박스 설정 Then 비활성화", async () => {
    const { buildSandboxConfig } = await import("./sandbox.js");
    const config = buildSandboxConfig("owner");
    expect(config.enabled).toBe(false);
  });

  test("Given observer 프로필 When 샌드박스 설정 Then 활성화", async () => {
    const { buildSandboxConfig } = await import("./sandbox.js");
    const config = buildSandboxConfig("observer");
    expect(config.enabled).toBe(true);
    expect(config.timeout_seconds).toBe(60);
  });
});

describe("Claude Args (YAML)", () => {
  test("Given owner When buildClaudeArgs Then skip-permissions 포함", async () => {
    const { buildClaudeArgs } = await import("./permissions.js");
    const args = buildClaudeArgs("owner", "test prompt");

    expect(args).toContain("--dangerously-skip-permissions");
  });

  test("Given developer When buildClaudeArgs Then allowedTools + disallowedTools 포함", async () => {
    const { buildClaudeArgs } = await import("./permissions.js");
    const args = buildClaudeArgs("developer", "test prompt");

    expect(args).toContain("--allowedTools");
    expect(args).toContain("--disallowedTools");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  test("Given observer When buildClaudeArgs Then 로컬 파일 도구 모두 미포함", async () => {
    const { buildClaudeArgs } = await import("./permissions.js");
    const args = buildClaudeArgs("observer", "test prompt");

    const allowedIdx = args.indexOf("--allowedTools");
    const tools = args[allowedIdx + 1];
    // observer는 로컬 파일에 접근 불가 — Read/Glob/Grep도 모두 제외
    expect(tools).not.toContain("Write");
    expect(tools).not.toContain("Edit");
    expect(tools).not.toContain("Read");
    expect(tools).not.toContain("Glob");
    expect(tools).not.toContain("Grep");
    // 대신 WebSearch와 메모리 도구로만 답변
    expect(tools).toContain("WebSearch");
    expect(tools).toContain("jarvis_memory_recall");
  });
});

describe("Profile List", () => {
  test("Given 프로필 목록 When 조회 Then 이름과 설명 반환", async () => {
    const { listProfiles } = await import("./profiles.js");
    const list = listProfiles();

    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list[0]).toHaveProperty("name");
    expect(list[0]).toHaveProperty("description");
  });
});

describe("Cron Job Parsing", () => {
  test("Given 크론잡 모듈 When import Then 함수 존재", async () => {
    const { addCronJob } = await import("./cron.js");
    expect(typeof addCronJob).toBe("function");
  });
});

describe("Claude Session Handle", () => {
  // 테스트 user_id는 실제 파일을 건드리므로 고유하게 + 테스트 후 정리
  const TEST_USER = "test:claude-session-lifecycle";

  const cleanup = async () => {
    const { unlinkSync, existsSync } = await import("node:fs");
    const { userFilePath } = await import("./auth.js");
    const path = userFilePath(TEST_USER);
    if (existsSync(path)) unlinkSync(path);
  };

  test("첫 호출: 새 UUID + started=false (--session-id 사용)", async () => {
    await cleanup();
    const { getOrCreateClaudeSessionId } = await import("./auth.js");

    const handle = getOrCreateClaudeSessionId(TEST_USER);
    expect(handle.session_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(handle.started).toBe(false);
    await cleanup();
  });

  test("두 번째 호출: 같은 UUID + started=false (아직 mark 전)", async () => {
    await cleanup();
    const { getOrCreateClaudeSessionId } = await import("./auth.js");

    const h1 = getOrCreateClaudeSessionId(TEST_USER);
    const h2 = getOrCreateClaudeSessionId(TEST_USER);
    expect(h2.session_id).toBe(h1.session_id);
    expect(h2.started).toBe(false);
    await cleanup();
  });

  test("markSessionStarted 이후: started=true (--resume 사용)", async () => {
    await cleanup();
    const { getOrCreateClaudeSessionId, markClaudeSessionStarted } = await import("./auth.js");

    const h1 = getOrCreateClaudeSessionId(TEST_USER);
    markClaudeSessionStarted(TEST_USER);
    const h2 = getOrCreateClaudeSessionId(TEST_USER);
    expect(h2.session_id).toBe(h1.session_id); // 같은 UUID
    expect(h2.started).toBe(true);              // 하지만 resume 모드
    await cleanup();
  });

  test("/clear (reset): UUID 삭제 + started=false + jsonl 삭제 시도", async () => {
    await cleanup();
    const { getOrCreateClaudeSessionId, markClaudeSessionStarted, resetClaudeSessionId } =
      await import("./auth.js");

    const h1 = getOrCreateClaudeSessionId(TEST_USER);
    markClaudeSessionStarted(TEST_USER);

    // resetClaudeSessionId는 { session_id, deleted_path } 반환
    const result = resetClaudeSessionId(TEST_USER);
    expect(result.session_id).toBe(h1.session_id);
    // 테스트 환경에선 jsonl 파일이 없으므로 deleted_path는 null
    // (실제 세션에선 Claude Code가 jsonl 생성 후 파일이 존재)
    expect(result.deleted_path).toBeNull();

    const h2 = getOrCreateClaudeSessionId(TEST_USER);
    expect(h2.session_id).not.toBe(h1.session_id); // 새 UUID
    expect(h2.started).toBe(false);                // 새로 시작
    await cleanup();
  });
});
