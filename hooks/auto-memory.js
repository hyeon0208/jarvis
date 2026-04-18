#!/usr/bin/env node

/**
 * Jarvis Auto Memory Hook (PostToolUse)
 *
 * 세션 중 도구 사용을 추적하고, 주요 이벤트를 세션 로그에 기록합니다.
 * Claude Code의 PostToolUse 훅으로 등록합니다.
 *
 * 환경 변수 (Claude Code가 제공):
 * - CLAUDE_SESSION_ID: 현재 세션 ID
 * - CLAUDE_TOOL_NAME: 사용된 도구 이름
 * - CLAUDE_TOOL_INPUT: 도구 입력 (JSON, stdin으로 전달)
 *
 * 저장 위치: ~/.jarvis/sessions/<session-id>.json
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const HOME = process.env.HOME || "~";
const SESSIONS_DIR = path.join(HOME, ".jarvis", "sessions");
const SESSION_ID = process.env.CLAUDE_SESSION_ID || `unknown-${Date.now()}`;
const TOOL_NAME = process.env.CLAUDE_TOOL_NAME || "unknown";
const SESSION_FILE = path.join(SESSIONS_DIR, `${SESSION_ID}.json`);

const DB_PATH = path.join(HOME, ".jarvis", "data", "memory.db");
const MEMORY_YML = path.join(HOME, "jarvis", "config", "memory.yml");
const COOLDOWN_FILE = path.join(HOME, ".jarvis", "data", "last-auto-dream.txt");
const DREAMING_CRON = path.join(HOME, "jarvis", "hooks", "dreaming-cron.js");

const POLICY_DEFAULTS = {
  soft_limit_mb: 1024,
  hard_limit_mb: 2048,
  auto_dream_cooldown_seconds: 300,
};

function loadPolicy() {
  if (!fs.existsSync(MEMORY_YML)) return { ...POLICY_DEFAULTS };
  try {
    const content = fs.readFileSync(MEMORY_YML, "utf-8");
    // 가벼운 YAML 파싱 — soft_limit_mb / hard_limit_mb / auto_dream_cooldown_seconds 만 추출
    const out = { ...POLICY_DEFAULTS };
    for (const line of content.split("\n")) {
      const m = line.match(/^\s*(soft_limit_mb|hard_limit_mb|auto_dream_cooldown_seconds)\s*:\s*(\d+)/);
      if (m) out[m[1]] = Number(m[2]);
    }
    return out;
  } catch {
    return { ...POLICY_DEFAULTS };
  }
}

function getDbSizeMb() {
  if (!fs.existsSync(DB_PATH)) return 0;
  try {
    return fs.statSync(DB_PATH).size / (1024 * 1024);
  } catch {
    return 0;
  }
}

function shouldRunDream(cooldownSeconds) {
  if (!fs.existsSync(COOLDOWN_FILE)) return true;
  try {
    const lastTs = Number(fs.readFileSync(COOLDOWN_FILE, "utf-8").trim());
    if (!Number.isFinite(lastTs)) return true;
    return Date.now() - lastTs >= cooldownSeconds * 1000;
  } catch {
    return true;
  }
}

function markDreamRan() {
  try {
    fs.writeFileSync(COOLDOWN_FILE, String(Date.now()));
  } catch {
    // 무시
  }
}

function maybeTriggerDreaming() {
  const policy = loadPolicy();
  const sizeMb = getDbSizeMb();
  if (sizeMb < policy.soft_limit_mb) return;

  if (!shouldRunDream(policy.auto_dream_cooldown_seconds)) return;
  if (!fs.existsSync(DREAMING_CRON)) return;

  // 백그라운드로 Dreaming 실행 (실패해도 훅이 Claude Code를 방해하지 않음)
  // bun:sqlite 사용을 위해 bun으로 spawn
  try {
    const child = spawn("bun", ["run", DREAMING_CRON], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    markDreamRan();
  } catch {
    // 무시
  }
}

// 추적할 도구 (노이즈 제거: Read/Glob/Grep 등 읽기 도구는 제외)
const TRACKED_TOOLS = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "Bash",
  "Agent",
  "NotebookEdit",
]);

// 의미 있는 이벤트만 기록
const IMPORTANT_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

function main() {
  // 추적 대상이 아닌 도구는 무시
  if (!TRACKED_TOOLS.has(TOOL_NAME)) return;

  // 세션 디렉토리 생성
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }

  // 세션 상태 로드
  let session = {
    session_id: SESSION_ID,
    started_at: new Date().toISOString(),
    tool_count: 0,
    file_changes: 0,
    tools_used: {},
    files_modified: [],
    last_activity: null,
    synced: false, // MCP 서버에 동기화 여부
  };

  try {
    if (fs.existsSync(SESSION_FILE)) {
      session = JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8"));
    }
  } catch {
    // 파싱 실패 시 초기화
  }

  // 도구 사용 카운트
  session.tool_count++;
  session.tools_used[TOOL_NAME] =
    (session.tools_used[TOOL_NAME] || 0) + 1;
  session.last_activity = new Date().toISOString();

  // 파일 변경 추적
  if (IMPORTANT_TOOLS.has(TOOL_NAME)) {
    session.file_changes++;

    // stdin에서 도구 입력 읽기 (file_path 추출)
    try {
      let input = "";
      const fd = fs.openSync("/dev/stdin", "r");
      const buf = Buffer.alloc(4096);
      const bytesRead = fs.readSync(fd, buf, 0, buf.length);
      fs.closeSync(fd);
      if (bytesRead > 0) {
        input = buf.toString("utf-8", 0, bytesRead);
        const parsed = JSON.parse(input);
        const filePath = parsed.file_path || parsed.path;
        if (
          filePath &&
          !session.files_modified.includes(filePath)
        ) {
          session.files_modified.push(filePath);
        }
      }
    } catch {
      // stdin 읽기 실패는 무시
    }
  }

  // 동기화 필요 마킹
  session.synced = false;

  // 저장
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));

  // DB 크기가 soft_limit_mb를 넘으면 백그라운드 Dreaming 트리거
  // (cooldown 적용해서 폭주 방지)
  maybeTriggerDreaming();
}

try {
  main();
} catch {
  // 훅 실패가 Claude Code를 방해하지 않도록
}
