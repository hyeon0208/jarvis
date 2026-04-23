#!/usr/bin/env node

/**
 * Jarvis Skill Nudge Hook (PostToolUse)
 *
 * 세션의 복잡도를 추적하고, 복잡한 작업 후 스킬 생성을 제안합니다.
 * auto-memory.js가 기록한 세션 상태를 읽어 판단합니다.
 *
 * 넛지 조건 (OR — 하나만 충족해도 뜸):
 * - 도구 호출 8회 이상   (재사용 가치가 있는 반복 작업이 보통 이 근방에서 드러남)
 * - 파일 변경 5개 이상
 * - 경과 시간 30분 이상
 *
 * 넛지는 조건 충족 후 최초 1회만 표시합니다.
 */

const fs = require("fs");
const path = require("path");

const SESSIONS_DIR = path.join(process.env.HOME || "~", ".jarvis", "sessions");
const SESSION_ID = process.env.CLAUDE_SESSION_ID || "";
const SESSION_FILE = path.join(SESSIONS_DIR, `${SESSION_ID}.json`);
const NUDGE_FILE = path.join(SESSIONS_DIR, `${SESSION_ID}.nudged`);

// 복잡도 임계값
const TOOL_THRESHOLD = 8;
const FILE_THRESHOLD = 5;
const TIME_THRESHOLD_MIN = 30;

function main() {
  if (!SESSION_ID || !fs.existsSync(SESSION_FILE)) return;

  // 이미 넛지했으면 스킵
  if (fs.existsSync(NUDGE_FILE)) return;

  let session;
  try {
    session = JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8"));
  } catch {
    return;
  }

  const elapsed =
    (Date.now() - new Date(session.started_at).getTime()) / 1000 / 60;

  const isComplex =
    session.tool_count >= TOOL_THRESHOLD ||
    session.file_changes >= FILE_THRESHOLD ||
    elapsed >= TIME_THRESHOLD_MIN;

  if (!isComplex) return;

  // 넛지 마커 생성 (세션당 1회만)
  fs.writeFileSync(NUDGE_FILE, new Date().toISOString());

  // 넛지 메시지 출력 (Claude Code가 사용자에게 전달)
  const stats = [
    `도구 ${session.tool_count}회`,
    `파일 변경 ${session.file_changes}건`,
    `${Math.round(elapsed)}분 경과`,
  ].join(", ");

  console.log(
    `[Jarvis] 복잡한 작업이 감지되었습니다 (${stats}). ` +
      `이 작업을 스킬로 저장하면 다음에 재사용할 수 있습니다. ` +
      `/skill-generator 를 실행해보세요.`,
  );
}

try {
  main();
} catch {
  // 훅 실패가 Claude Code를 방해하지 않도록
}
