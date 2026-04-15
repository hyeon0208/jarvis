#!/usr/bin/env node

/**
 * Jarvis Skill Nudge Hook
 *
 * PostToolUse 훅으로 등록하여, 세션의 복잡도를 추적하고
 * 복잡한 작업 후 스킬 생성을 제안합니다.
 *
 * 설치: settings.json의 hooks.PostToolUse에 추가
 */

const STATE_FILE = `${process.env.HOME}/.jarvis/session-complexity.json`;

async function main() {
  const fs = await import("fs");

  // 상태 파일 로드 또는 초기화
  let state = { toolCalls: 0, fileChanges: 0, startTime: Date.now() };
  try {
    if (fs.existsSync(STATE_FILE)) {
      state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    }
  } catch {
    // 첫 실행 시 무시
  }

  // 카운터 증가
  state.toolCalls++;

  // 파일 변경 감지 (Edit/Write 도구)
  const toolName = process.env.CLAUDE_TOOL_NAME || "";
  if (["Edit", "Write", "MultiEdit"].includes(toolName)) {
    state.fileChanges++;
  }

  // 상태 저장
  const dir = `${process.env.HOME}/.jarvis`;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));

  // 복잡도 체크: 도구 10회+ 또는 파일 변경 5개+
  const elapsed = (Date.now() - state.startTime) / 1000 / 60; // 분
  const isComplex =
    state.toolCalls >= 10 || state.fileChanges >= 5 || elapsed >= 30;

  if (isComplex && state.toolCalls % 10 === 0) {
    // 10회마다 한 번 넛지 (너무 자주 방해하지 않기 위해)
    console.log(
      `[Jarvis] 복잡한 작업이 감지되었습니다 (도구 ${state.toolCalls}회, 파일 변경 ${state.fileChanges}건, ${Math.round(elapsed)}분 경과). /skill-generator 로 스킬화를 고려해보세요.`,
    );
  }
}

main().catch(() => {});
