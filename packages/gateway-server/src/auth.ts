import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

const DATA_DIR = join(process.env.HOME ?? "~", ".jarvis", "data");
const USERS_DIR = join(process.env.HOME ?? "~", ".jarvis", "users");
const PAIRING_FILE = join(DATA_DIR, "pending-pairings.json");

export interface PairingRequest {
  user_id: string;
  channel: string;
  code: string;
  display_name: string;
  requested_at: string;
  expires_at: string;
}

function ensureDirs(): void {
  for (const dir of [DATA_DIR, USERS_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

/** 6자리 페어링 코드 생성 */
function generateCode(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}

/** 대기 중인 페어링 요청 로드 */
function loadPendingPairings(): PairingRequest[] {
  ensureDirs();
  if (!existsSync(PAIRING_FILE)) return [];
  try {
    return JSON.parse(readFileSync(PAIRING_FILE, "utf-8"));
  } catch {
    return [];
  }
}

/** 대기 중인 페어링 요청 저장 */
function savePendingPairings(pairings: PairingRequest[]): void {
  ensureDirs();
  writeFileSync(PAIRING_FILE, JSON.stringify(pairings, null, 2));
}

/** 유저 설정 파일 경로 */
export function userFilePath(userId: string): string {
  // 파일명에 안전한 문자만 사용
  const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(USERS_DIR, `${safeId}.json`);
}

/** 유저가 페어링(인증)되었는지 확인 */
export function isUserPaired(userId: string): boolean {
  const filePath = userFilePath(userId);
  if (!existsSync(filePath)) return false;
  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    return data.paired === true;
  } catch {
    return false;
  }
}

/** 새 페어링 요청 생성 (알 수 없는 발신자가 메시지를 보낼 때) */
export function createPairingRequest(
  userId: string,
  channel: string,
  displayName: string,
): PairingRequest {
  const pairings = loadPendingPairings();

  // 기존 요청이 있으면 제거
  const filtered = pairings.filter((p) => p.user_id !== userId);

  const request: PairingRequest = {
    user_id: userId,
    channel,
    code: generateCode(),
    display_name: displayName,
    requested_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24시간
  };

  filtered.push(request);
  savePendingPairings(filtered);
  return request;
}

/** 페어링 코드 검증 및 승인 */
export function approvePairing(
  code: string,
  profile = "observer",
): { success: boolean; userId?: string; error?: string } {
  const pairings = loadPendingPairings();
  const index = pairings.findIndex((p) => p.code === code);

  if (index === -1) {
    return { success: false, error: "유효하지 않은 페어링 코드입니다" };
  }

  const request = pairings[index];

  // 만료 확인
  if (new Date(request.expires_at) < new Date()) {
    pairings.splice(index, 1);
    savePendingPairings(pairings);
    return { success: false, error: "만료된 페어링 코드입니다" };
  }

  // 유저 파일 생성
  ensureDirs();
  const userData = {
    user_id: request.user_id,
    name: request.display_name,
    profile,
    channel: request.channel,
    paired: true,
    paired_at: new Date().toISOString(),
    personality: {
      tone: "friendly",
      language: "ko",
      verbosity: "normal",
      emoji: false,
      nickname: "Jarvis",
    },
    cron_jobs: [],
  };

  writeFileSync(userFilePath(request.user_id), JSON.stringify(userData, null, 2));

  // 대기 목록에서 제거
  pairings.splice(index, 1);
  savePendingPairings(pairings);

  return { success: true, userId: request.user_id };
}

/**
 * 페어링 코드 없이 유저를 즉시 등록합니다 (채널 자동 페어링용).
 *
 * 사용처: channels.yml의 `auto_pair: true`가 켜진 채널에서 등록되지 않은
 * 발신자의 메시지가 들어왔을 때. 워크스페이스 수준 게이트(Slack 멤버십 등)가
 * 이미 접근을 통제하므로 페어링 코드 발급 단계를 건너뛰는 게 UX상 낫습니다.
 *
 * - 이미 등록된 유저면 no-op (중복 방지).
 * - 감사용 `auto_paired: true` 플래그를 기록.
 */
export function autoPairUser(
  userId: string,
  displayName: string,
  channel: string,
  profile: string,
): boolean {
  ensureDirs();
  if (isUserPaired(userId)) return false;

  const userData = {
    user_id: userId,
    name: displayName,
    profile,
    channel,
    paired: true,
    paired_at: new Date().toISOString(),
    auto_paired: true,
    personality: {
      tone: "friendly",
      language: "ko",
      verbosity: "normal",
      emoji: false,
      nickname: "Jarvis",
    },
    cron_jobs: [],
  };

  writeFileSync(userFilePath(userId), JSON.stringify(userData, null, 2));
  return true;
}

/** 대기 중인 페어링 요청 목록 */
export function listPendingPairings(): PairingRequest[] {
  const pairings = loadPendingPairings();
  const now = new Date();
  // 만료된 것 필터
  return pairings.filter((p) => new Date(p.expires_at) > now);
}

/** 페어링 거부 */
export function rejectPairing(userId: string): boolean {
  const pairings = loadPendingPairings();
  const filtered = pairings.filter((p) => p.user_id !== userId);
  if (filtered.length === pairings.length) return false;
  savePendingPairings(filtered);
  return true;
}

/** 유저 설정 로드 */
export function loadUserConfig(userId: string): Record<string, unknown> | null {
  const filePath = userFilePath(userId);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/** 유저 설정 업데이트 */
export function updateUserConfig(
  userId: string,
  updates: Record<string, unknown>,
): boolean {
  const current = loadUserConfig(userId);
  if (!current) return false;
  const merged = { ...current, ...updates };
  writeFileSync(userFilePath(userId), JSON.stringify(merged, null, 2));
  return true;
}

/**
 * Claude 세션 핸들 — user_id별 대화 컨텍스트 관리.
 *
 * Claude CLI의 특성:
 * - `--session-id <UUID>`: 새 세션 생성 (이미 존재하는 UUID면 "already in use" 에러)
 * - `--resume <UUID>`: 기존 세션에 이어붙이기
 *
 * 따라서 같은 user의 첫 호출과 이후 호출에 다른 플래그를 써야 합니다.
 * `started` 플래그로 이 상태를 추적합니다.
 */
export interface ClaudeSessionHandle {
  session_id: string;
  started: boolean; // false면 --session-id로 새로 시작, true면 --resume으로 이어감
}

/**
 * Claude 세션 핸들을 반환합니다 (없으면 새 UUID 생성).
 *
 * - 파일에 session_id가 없음 → 새 UUID 생성 후 저장, started=false
 * - 파일에 session_id가 있고 started=true → 기존 UUID + started=true
 * - 파일에 session_id가 있지만 started=false (생성만 됐고 spawn 아직) → 그대로 반환
 *
 * 저장: ~/.jarvis/users/{safe-user-id}.json
 *       { claude_session_id: "uuid", claude_session_started: true/false }
 */
export function getOrCreateClaudeSessionId(userId: string): ClaudeSessionHandle {
  const config = loadUserConfig(userId);

  if (config && typeof config.claude_session_id === "string" && config.claude_session_id) {
    // 마이그레이션: claude_session_started 필드가 없는 레거시 데이터는
    // 이미 claude에서 세션이 생성됐을 가능성이 높으므로 started=true로 간주
    // (--session-id 재사용 시 "already in use" 에러 방지)
    const started =
      config.claude_session_started === undefined
        ? true
        : Boolean(config.claude_session_started);
    return {
      session_id: config.claude_session_id,
      started,
    };
  }

  // 새 UUID 발급
  const newId = randomUUID();
  if (config) {
    updateUserConfig(userId, {
      claude_session_id: newId,
      claude_session_started: false,
    });
  } else {
    writeFileSync(
      userFilePath(userId),
      JSON.stringify(
        { user_id: userId, claude_session_id: newId, claude_session_started: false },
        null,
        2,
      ),
    );
  }
  return { session_id: newId, started: false };
}

/**
 * 세션이 실제로 claude에 의해 생성됨을 표시합니다 (첫 spawn 성공 후 호출).
 * 이후부터는 --resume을 사용해야 합니다.
 */
export function markClaudeSessionStarted(userId: string): void {
  const config = loadUserConfig(userId);
  if (!config) return;
  updateUserConfig(userId, { claude_session_started: true });
}

/**
 * 주어진 UUID에 해당하는 claude 세션 jsonl 파일이 디스크에 존재하는지 확인합니다.
 *
 * 사용처: --session-id vs --resume 분기 판단.
 * user 파일의 claude_session_started 플래그가 어떤 이유로 잘못 기록돼 있을 수 있으므로,
 * 실제 jsonl 존재 여부를 "ground truth"로 삼는 게 견고합니다.
 *
 * - 파일 있음 → 이미 claude가 세션 생성했음 → --resume 사용해야 함
 * - 파일 없음 → 새 세션 → --session-id 사용
 */
export function hasClaudeSessionJsonl(sessionId: string): boolean {
  if (!sessionId) return false;
  const projectsDir = join(process.env.HOME ?? "~", ".claude", "projects");
  if (!existsSync(projectsDir)) return false;

  try {
    for (const dir of readdirSync(projectsDir)) {
      if (existsSync(join(projectsDir, dir, `${sessionId}.jsonl`))) return true;
    }
  } catch {
    // projects 디렉토리 읽기 실패는 무시
  }
  return false;
}

/**
 * 주어진 UUID의 claude 세션 jsonl 파일을 디스크에서 삭제합니다.
 *
 * Claude Code는 세션을 ~/.claude/projects/{cwd-해시}/{UUID}.jsonl로 저장합니다.
 * cwd-해시 생성 규칙이 Claude Code 내부 규약이라 정확히 재현하기보다,
 * projects 하위의 모든 디렉토리를 순회하며 {UUID}.jsonl을 찾아 삭제합니다.
 * UUID는 전역 유니크하므로 중복 매칭 우려 없음.
 *
 * 반환: 삭제한 파일 경로 (없었으면 null)
 */
function deleteClaudeSessionJsonl(sessionId: string): string | null {
  if (!sessionId) return null;
  const projectsDir = join(process.env.HOME ?? "~", ".claude", "projects");
  if (!existsSync(projectsDir)) return null;

  try {
    for (const dir of readdirSync(projectsDir)) {
      const file = join(projectsDir, dir, `${sessionId}.jsonl`);
      if (existsSync(file)) {
        try {
          rmSync(file);
          return file;
        } catch {
          // 권한/I/O 실패는 조용히 넘어감 (세션 포인터는 이미 리셋됨)
          return null;
        }
      }
    }
  } catch {
    // projects 디렉토리 읽기 실패는 무시
  }
  return null;
}

/**
 * Claude 세션을 초기화합니다 (/clear).
 *
 * 동작:
 * 1. user 파일의 claude_session_id = null, claude_session_started = false
 * 2. 이전 세션의 jsonl 파일을 디스크에서 실제 삭제
 *    (대화 기록이 남아있으면 개인정보/시크릿 노출 위험 + 사용자 기대와 불일치)
 *
 * 반환: { session_id: 이전 UUID, deleted_path: 삭제된 파일 경로 또는 null }
 */
export function resetClaudeSessionId(userId: string): {
  session_id: string | null;
  deleted_path: string | null;
} {
  const config = loadUserConfig(userId);
  if (!config) return { session_id: null, deleted_path: null };

  const previous = (config.claude_session_id as string | undefined) ?? null;
  updateUserConfig(userId, {
    claude_session_id: null,
    claude_session_started: false,
  });

  const deletedPath = previous ? deleteClaudeSessionJsonl(previous) : null;
  return { session_id: previous, deleted_path: deletedPath };
}

/**
 * /compact 결과로 생성된 요약을 user 파일에 저장합니다.
 * 다음 번 executeWithClaude 호출에서 prompt 앞에 한 번만 주입된 뒤 소비됩니다.
 */
export function setPendingCompactSummary(userId: string, summary: string): void {
  updateUserConfig(userId, { pending_compact_summary: summary });
}

/**
 * pending compact 요약을 읽고 즉시 비웁니다 (one-shot).
 * 반환값이 있으면 다음 prompt 앞에 붙여주세요.
 */
export function consumePendingCompactSummary(userId: string): string | null {
  const config = loadUserConfig(userId);
  if (!config) return null;
  const summary = config.pending_compact_summary as string | undefined;
  if (!summary) return null;
  updateUserConfig(userId, { pending_compact_summary: null });
  return summary;
}

/**
 * 마지막 활동 시각을 기록합니다 (매 메시지 처리 시 호출).
 * TTL 기반 자동 clear(`session_ttl_hours`)가 이 값을 기준으로 판정합니다.
 */
export function touchUserActivity(userId: string): void {
  const config = loadUserConfig(userId);
  if (!config) return;
  updateUserConfig(userId, { last_active_at: new Date().toISOString() });
}

// ============================================================
// Thread 단위 공유 세션 — 공용 채널 스레드에서 참여자 전원이 같은 Claude 세션
// 맥락을 공유하도록 UUID를 scopeKey(예: "slack:thread:{channel}:{thread_ts}")
// 단위로 관리합니다. 개인 격리(프로필/메모리/personality)는 여전히 user_id
// 단위이며, 이 함수들은 "단기 대화 세션" 축 한 가지에만 적용됩니다.
// 저장: ~/.jarvis/data/thread-sessions.json
// ============================================================

const THREAD_SESSIONS_FILE = join(DATA_DIR, "thread-sessions.json");

interface ThreadSessionEntry {
  session_id: string;
  started: boolean;
}

function loadThreadSessions(): Record<string, ThreadSessionEntry> {
  ensureDirs();
  if (!existsSync(THREAD_SESSIONS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(THREAD_SESSIONS_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveThreadSessions(data: Record<string, ThreadSessionEntry>): void {
  ensureDirs();
  writeFileSync(THREAD_SESSIONS_FILE, JSON.stringify(data, null, 2));
}

/**
 * 스코프 키 기반 Claude 세션 핸들 조회/생성.
 * 스레드 참여자가 같은 scopeKey를 전달하면 같은 UUID로 --resume 되어
 * Claude 맥락이 이어집니다.
 */
export function getOrCreateThreadSessionId(scopeKey: string): ClaudeSessionHandle {
  const data = loadThreadSessions();
  const existing = data[scopeKey];
  if (existing && existing.session_id) {
    return { session_id: existing.session_id, started: Boolean(existing.started) };
  }
  const newId = randomUUID();
  data[scopeKey] = { session_id: newId, started: false };
  saveThreadSessions(data);
  return { session_id: newId, started: false };
}

/** 스레드 세션이 실제로 claude에 의해 생성됐음을 마킹 (첫 spawn 성공 후). */
export function markThreadSessionStarted(scopeKey: string): void {
  const data = loadThreadSessions();
  if (!data[scopeKey]) return;
  data[scopeKey].started = true;
  saveThreadSessions(data);
}

/** 스레드 세션 초기화 (jsonl도 실제 삭제). */
export function resetThreadSessionId(scopeKey: string): {
  session_id: string | null;
  deleted_path: string | null;
} {
  const data = loadThreadSessions();
  const entry = data[scopeKey];
  if (!entry) return { session_id: null, deleted_path: null };
  const previous = entry.session_id;
  delete data[scopeKey];
  saveThreadSessions(data);
  const deletedPath = previous ? deleteClaudeSessionJsonl(previous) : null;
  return { session_id: previous, deleted_path: deletedPath };
}
