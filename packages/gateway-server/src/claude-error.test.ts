import { describe, test, expect } from "bun:test";
import { formatClaudeError } from "./claude-error.js";

describe("claude-error: formatClaudeError", () => {
  test("Given 빈 stderr와 stdout으로 exit 1 When 변환 Then 사유 없는 종료 메시지에 진단 안내 포함", () => {
    const result = formatClaudeError({ code: 1, stderr: "", stdout: "" });
    expect(result.userMessage).toContain("사유 없이 종료");
    expect(result.userMessage).toContain("코드: 1");
    expect(result.userMessage).toContain("jarvis logs");
    expect(result.logSummary).toBe("code=1, stderr=<empty>, stdout=<empty>");
  });

  test("Given 'Session ID is already in use' stderr When 변환 Then 동시 실행 안내", () => {
    const result = formatClaudeError({
      code: 1,
      stderr: "Error: Session ID 141b9acc-6a2d-4e1e-b968-8923a137dc7f is already in use.",
      stdout: "",
    });
    expect(result.userMessage).toContain("다른 작업이 이미 진행 중");
    expect(result.userMessage).toContain("잠시 후 다시 시도");
  });

  test("Given 'No conversation found' stderr When 변환 Then 세션 리셋 안내 + 세션 ID 일부 표시", () => {
    const result = formatClaudeError({
      code: 1,
      stderr: "No conversation found with session ID: 7b063253-82b5-4536-82fb-fe1c5e380208",
      stdout: "",
    });
    expect(result.userMessage).toContain("이전 대화 세션");
    expect(result.userMessage).toContain("7b063253");
    expect(result.userMessage).toContain("/clear");
  });

  test("Given exit code 143 (SIGTERM) When 변환 Then 외부 신호 종료 메시지", () => {
    const result = formatClaudeError({ code: 143, stderr: "", stdout: "" });
    expect(result.userMessage).toContain("외부 신호");
    expect(result.userMessage).toContain("SIGTERM");
  });

  test("Given stdout에만 진단 단서 When 변환 Then 단서를 사용자 메시지에 포함", () => {
    const result = formatClaudeError({
      code: 1,
      stderr: "",
      stdout: "API request failed: model not available",
    });
    expect(result.userMessage).toContain("API request failed");
  });

  test("Given Warning만 있는 stderr When 변환 Then Warning은 무시하고 stdout 단서를 우선", () => {
    const result = formatClaudeError({
      code: 1,
      stderr: "Warning: no stdin data received in 3s, proceeding without it.",
      stdout: "Authentication required: 401 Unauthorized",
    });
    expect(result.userMessage).toContain("Claude 인증 실패");
  });

  test("Given rate limit 에러 When 변환 Then 호출 한도 안내", () => {
    const result = formatClaudeError({
      code: 1,
      stderr: "rate_limit_exceeded: too many requests",
      stdout: "",
    });
    expect(result.userMessage).toContain("호출 한도");
  });

  test("Given child error로 code=null When 변환 Then ENOENT 패턴 인식", () => {
    const result = formatClaudeError({
      code: null,
      stderr: "spawn claude ENOENT",
      stdout: "",
    });
    expect(result.userMessage).toContain("실행 파일을 찾지 못했습니다");
  });
});
