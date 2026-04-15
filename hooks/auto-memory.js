#!/usr/bin/env node

/**
 * Jarvis Auto Memory Hook
 *
 * 세션 중 주요 이벤트를 감지하여 메모리 서버에 자동 기록합니다.
 * PostToolUse 훅으로 등록합니다.
 */

async function main() {
  // 현재는 스텁 — 메모리 서버 구현 후 MCP 연동
  // TODO: 세션 컨텍스트를 메모리 서버에 자동 저장
  // TODO: 사용자 피드백(수정/승인) 패턴 감지하여 선호도 기록
}

main().catch(() => {});
