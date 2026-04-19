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
