/**
 * 설정 파일 CRUD + 백업
 *
 * - profiles.yml / channels.yml: yaml.parseDocument로 코멘트 보존
 * - projects.jsonc: 단일 라인 주석(//)만 보존하는 경량 구현
 * - .env: key=value 라인 단위 upsert
 * - ~/.claude/settings.json: idempotent 머지 + 타임스탬프 백업
 */

import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  Document,
  parse as parseYaml,
  parseDocument,
  stringify as stringifyYaml,
} from "yaml";

const HOME = process.env.HOME ?? "~";
export const PATHS = {
  profilesYml: join(HOME, "jarvis", "config", "profiles.yml"),
  channelsYml: join(HOME, "jarvis", "config", "channels.yml"),
  projectsJsonc: join(HOME, "jarvis", "config", "projects.jsonc"),
  memoryYml: join(HOME, "jarvis", "config", "memory.yml"),
  envFile: join(HOME, "jarvis", ".env"),
  claudeSettings: join(HOME, ".claude", "settings.json"),
  usersDir: join(HOME, ".jarvis", "users"),
  memoryDb: join(HOME, ".jarvis", "data", "memory.db"),
  pendingPairings: join(HOME, ".jarvis", "data", "pending-pairings.json"),
  daemonPid: join(HOME, ".jarvis", "daemon.pid"),
  daemonLog: join(HOME, ".jarvis", "daemon.log"),
};

// ============================================================
// 공통 유틸
// ============================================================

function backup(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bak = `${filePath}.bak.${stamp}`;
  copyFileSync(filePath, bak);
  return bak;
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ============================================================
// profiles.yml
// ============================================================

export interface ProfilesDocument {
  default_profile?: string;
  profiles: Record<string, Record<string, unknown>>;
}

export function loadProfilesYml(): ProfilesDocument {
  if (!existsSync(PATHS.profilesYml)) {
    return { default_profile: "observer", profiles: {} };
  }
  const content = readFileSync(PATHS.profilesYml, "utf-8");
  return parseYaml(content) as ProfilesDocument;
}

/** 주석 보존 저장 — yaml.Document API 사용 */
export function saveProfilesYml(data: ProfilesDocument): void {
  ensureDir(PATHS.profilesYml);
  backup(PATHS.profilesYml);

  // 기존 문서가 있으면 코멘트 보존, 없으면 새로 생성
  let doc: Document;
  if (existsSync(PATHS.profilesYml)) {
    const original = readFileSync(PATHS.profilesYml, "utf-8");
    doc = parseDocument(original);
    doc.contents = doc.createNode(data) as never;
  } else {
    doc = new Document(data);
  }
  writeFileSync(PATHS.profilesYml, String(doc));
}

// ============================================================
// channels.yml
// ============================================================

export interface ChannelsDocument {
  channels: Record<string, Record<string, unknown>>;
}

export function loadChannelsYml(): ChannelsDocument {
  if (!existsSync(PATHS.channelsYml)) return { channels: {} };
  const content = readFileSync(PATHS.channelsYml, "utf-8");
  return parseYaml(content) as ChannelsDocument;
}

export function saveChannelsYml(data: ChannelsDocument): void {
  ensureDir(PATHS.channelsYml);
  backup(PATHS.channelsYml);

  let doc: Document;
  if (existsSync(PATHS.channelsYml)) {
    const original = readFileSync(PATHS.channelsYml, "utf-8");
    doc = parseDocument(original);
    doc.contents = doc.createNode(data) as never;
  } else {
    doc = new Document(data);
  }
  writeFileSync(PATHS.channelsYml, String(doc));
}

// ============================================================
// memory.yml — 메모리 정책
// ============================================================

export interface MemoryPolicy {
  soft_limit_mb: number;
  hard_limit_mb: number;
  archive_days: number;
  auto_dream_cooldown_seconds: number;
}

export interface MemoryDocument {
  memory: MemoryPolicy;
}

const MEMORY_DEFAULTS: MemoryPolicy = {
  soft_limit_mb: 1024,
  hard_limit_mb: 2048,
  archive_days: 30,
  auto_dream_cooldown_seconds: 300,
};

export function loadMemoryYml(): MemoryPolicy {
  if (!existsSync(PATHS.memoryYml)) return { ...MEMORY_DEFAULTS };
  try {
    const content = readFileSync(PATHS.memoryYml, "utf-8");
    const parsed = parseYaml(content) as Partial<MemoryDocument> | null;
    return { ...MEMORY_DEFAULTS, ...(parsed?.memory ?? {}) };
  } catch {
    return { ...MEMORY_DEFAULTS };
  }
}

// ============================================================
// projects.jsonc
// ============================================================

export interface ProjectConfig {
  name: string;
  path: string;
  parent_branch: string;
  repo?: string;
  allowed_profiles: string[];
  branch_prefix: string;
}

export interface ProjectsDocument {
  projects: Record<string, ProjectConfig>;
}

export function loadProjectsJsonc(): ProjectsDocument {
  if (!existsSync(PATHS.projectsJsonc)) return { projects: {} };
  const raw = readFileSync(PATHS.projectsJsonc, "utf-8");
  const stripped = stripJsoncComments(raw);
  return JSON.parse(stripped) as ProjectsDocument;
}

/**
 * JSONC 저장 — 헤더 주석(파일 최상단의 연속된 // 라인)만 보존.
 * 본문 내부 주석은 보존되지 않습니다. 경량 구현의 트레이드오프.
 */
export function saveProjectsJsonc(data: ProjectsDocument): void {
  ensureDir(PATHS.projectsJsonc);
  backup(PATHS.projectsJsonc);

  const header = extractHeaderComments(
    existsSync(PATHS.projectsJsonc) ? readFileSync(PATHS.projectsJsonc, "utf-8") : "",
  );
  const body = JSON.stringify(data, null, 2);
  writeFileSync(PATHS.projectsJsonc, header + body + "\n");
}

function stripJsoncComments(raw: string): string {
  return raw
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractHeaderComments(raw: string): string {
  const lines: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed === "") {
      lines.push(line);
      continue;
    }
    break;
  }
  return lines.length > 0 ? lines.join("\n") + "\n" : "";
}

// ============================================================
// .env
// ============================================================

/** .env 파일에서 key=value 파싱 */
export function loadEnvFile(): Record<string, string> {
  const result: Record<string, string> = {};
  if (!existsSync(PATHS.envFile)) return result;

  const content = readFileSync(PATHS.envFile, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    result[key] = value;
  }
  return result;
}

/** 특정 키를 upsert. 기존 라인 보존, 주석 유지 */
export function upsertEnv(key: string, value: string): void {
  ensureDir(PATHS.envFile);

  if (!existsSync(PATHS.envFile)) {
    writeFileSync(PATHS.envFile, `${key}=${value}\n`);
    return;
  }

  backup(PATHS.envFile);
  const content = readFileSync(PATHS.envFile, "utf-8");
  const lines = content.split("\n");
  const pattern = new RegExp(`^\\s*${key}\\s*=`);

  let found = false;
  const updated = lines.map((line) => {
    if (pattern.test(line)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!found) {
    if (updated[updated.length - 1] !== "") updated.push("");
    updated.splice(updated.length - 1, 0, `${key}=${value}`);
  }

  writeFileSync(PATHS.envFile, updated.join("\n"));
}

// ============================================================
// ~/.claude/settings.json
// ============================================================

export interface ClaudeSettings {
  mcpServers?: Record<string, unknown>;
  permissions?: { allow?: string[] };
  hooks?: Record<string, Array<Record<string, unknown>>>;
  [key: string]: unknown;
}

export function loadClaudeSettings(): ClaudeSettings {
  if (!existsSync(PATHS.claudeSettings)) return {};
  const raw = readFileSync(PATHS.claudeSettings, "utf-8");
  return JSON.parse(stripJsoncComments(raw)) as ClaudeSettings;
}

/** idempotent 머지: 이미 존재하는 항목은 보존, 없는 항목만 추가 */
export function patchClaudeSettings(patch: {
  mcpServers?: Record<string, unknown>;
  permissionsAllow?: string[];
  postToolUseHooks?: Array<Record<string, unknown>>;
  userPromptSubmitHooks?: Array<Record<string, unknown>>;
}): { backup: string | null; changed: string[] } {
  const changed: string[] = [];
  const bak = backup(PATHS.claudeSettings);
  const settings = loadClaudeSettings();

  if (patch.mcpServers) {
    settings.mcpServers ??= {};
    for (const [name, cfg] of Object.entries(patch.mcpServers)) {
      if (!settings.mcpServers[name]) {
        settings.mcpServers[name] = cfg;
        changed.push(`mcpServers.${name}`);
      }
    }
  }

  if (patch.permissionsAllow) {
    settings.permissions ??= {};
    settings.permissions.allow ??= [];
    const allowSet = new Set(settings.permissions.allow);
    for (const perm of patch.permissionsAllow) {
      if (!allowSet.has(perm)) {
        settings.permissions.allow.push(perm);
        changed.push(`permissions.allow[${perm}]`);
      }
    }
  }

  if (patch.postToolUseHooks) {
    settings.hooks ??= {};
    settings.hooks.PostToolUse ??= [];
    for (const hook of patch.postToolUseHooks) {
      const exists = settings.hooks.PostToolUse.some(
        (h) => JSON.stringify(h) === JSON.stringify(hook),
      );
      if (!exists) {
        settings.hooks.PostToolUse.push(hook);
        changed.push(`hooks.PostToolUse[+1]`);
      }
    }
  }

  if (patch.userPromptSubmitHooks) {
    settings.hooks ??= {};
    settings.hooks.UserPromptSubmit ??= [];
    for (const hook of patch.userPromptSubmitHooks) {
      const exists = settings.hooks.UserPromptSubmit.some(
        (h) => JSON.stringify(h) === JSON.stringify(hook),
      );
      if (!exists) {
        settings.hooks.UserPromptSubmit.push(hook);
        changed.push(`hooks.UserPromptSubmit[+1]`);
      }
    }
  }

  if (changed.length > 0) {
    ensureDir(PATHS.claudeSettings);
    writeFileSync(PATHS.claudeSettings, JSON.stringify(settings, null, 2));
  }

  return { backup: bak, changed };
}

// ============================================================
// Users (~/.jarvis/users/*.json)
// ============================================================

export function userFilePath(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(PATHS.usersDir, `${safe}.json`);
}

export function listAllUsers(): Array<Record<string, unknown>> {
  if (!existsSync(PATHS.usersDir)) return [];
  const { readdirSync } = require("node:fs");
  const files = readdirSync(PATHS.usersDir) as string[];
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const content = readFileSync(join(PATHS.usersDir, f), "utf-8");
      try {
        return JSON.parse(content) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((x): x is Record<string, unknown> => x !== null);
}
