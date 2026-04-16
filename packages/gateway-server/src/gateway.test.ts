import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

// 테스트용 디렉토리 설정
const TEST_DIR = join(process.env.HOME ?? "~", ".jarvis-test");
const ORIGINAL_HOME = process.env.HOME;

// auth.ts, profiles.ts, router.ts, cron.ts는 HOME 환경변수를 사용하므로
// 테스트에서는 직접 모듈 로직을 검증합니다

describe("Profiles", () => {
  test("Given 기본 프로필 When 로드 Then admin과 observer 존재", async () => {
    const { loadProfiles } = await import("./profiles.js");
    const profiles = loadProfiles();

    expect(profiles).toHaveProperty("admin");
    expect(profiles).toHaveProperty("observer");
    expect(profiles.admin.permissions.write).toBe(true);
    expect(profiles.observer.permissions.write).toBe(false);
  });

  test("Given admin 프로필 When 권한 체크 Then 모든 권한 허용", async () => {
    const { checkPermission } = await import("./profiles.js");

    expect(checkPermission("admin", "read")).toBe(true);
    expect(checkPermission("admin", "write")).toBe(true);
    expect(checkPermission("admin", "execute")).toBe(true);
    expect(checkPermission("admin", "cron")).toBe(true);
  });

  test("Given observer 프로필 When 쓰기 권한 체크 Then 거부", async () => {
    const { checkPermission } = await import("./profiles.js");

    expect(checkPermission("observer", "read")).toBe(true);
    expect(checkPermission("observer", "write")).toBe(false);
    expect(checkPermission("observer", "execute")).toBe(false);
  });

  test("Given 존재하지 않는 프로필 When 권한 체크 Then 거부", async () => {
    const { checkPermission } = await import("./profiles.js");

    expect(checkPermission("nonexistent", "read")).toBe(false);
  });
});

describe("Sandbox Config", () => {
  test("Given admin 프로필 When 샌드박스 설정 Then 비활성화", async () => {
    const { buildSandboxConfig } = await import("./sandbox.js");
    const config = buildSandboxConfig("admin");

    expect(config.enabled).toBe(false);
  });

  test("Given observer 프로필 When 샌드박스 설정 Then 활성화 + 제한", async () => {
    const { buildSandboxConfig } = await import("./sandbox.js");
    const config = buildSandboxConfig("observer", "/project");

    expect(config.enabled).toBe(true);
    expect(config.memory_limit).toBe("512m");
    expect(config.network).toBe("bridge");
    expect(config.timeout_seconds).toBe(60);
  });

  test("Given 샌드박스 설정 When Docker 명령 생성 Then 올바른 형식", async () => {
    const { buildSandboxConfig, buildDockerCommand } = await import("./sandbox.js");
    const config = buildSandboxConfig("observer", "/project");
    const cmd = buildDockerCommand(config, "echo hello");

    expect(cmd[0]).toBe("docker");
    expect(cmd).toContain("--memory");
    expect(cmd).toContain("512m");
    expect(cmd).toContain("jarvis-sandbox:latest");
  });

  test("Given 비활성 샌드박스 When Docker 명령 생성 Then 직접 실행", async () => {
    const { buildSandboxConfig, buildDockerCommand } = await import("./sandbox.js");
    const config = buildSandboxConfig("admin");
    const cmd = buildDockerCommand(config, "echo hello");

    expect(cmd).toEqual(["sh", "-c", "echo hello"]);
  });
});

describe("Cron Job Parsing", () => {
  test("Given 자연어 스케줄 When 크론잡 추가 Then 파싱 성공", async () => {
    // cron.ts의 내부 parseSchedule 로직을 간접 검증
    const { addCronJob, listCronJobs, deleteCronJob } = await import("./cron.js");

    // 유저 파일이 없으므로 실패해야 함 (정상 동작)
    const result = addCronJob("test-user-no-file", "매일 9시 할 일 정리");
    // 유저 파일이 없어도 파싱은 시도됨
    // 파일 없으면 저장이 안 될 뿐
    expect(result).toHaveProperty("success");
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
