/**
 * 메모리 정책 로더 (memory-server 내부용)
 *
 * ~/jarvis/config/memory.yml을 핫 리로드 방식으로 읽습니다.
 * - 파일 없거나 파싱 실패 시 기본값 fallback
 * - mtime 캐시로 매 호출 디스크 I/O 최소화 (1초 단위)
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export interface MemoryPolicy {
  soft_limit_mb: number;
  hard_limit_mb: number;
  archive_days: number;
  auto_dream_cooldown_seconds: number;
}

const MEMORY_YML = join(process.env.HOME ?? "~", "jarvis", "config", "memory.yml");

const DEFAULTS: MemoryPolicy = {
  soft_limit_mb: 1024,
  hard_limit_mb: 2048,
  archive_days: 30,
  auto_dream_cooldown_seconds: 300,
};

let cached: { mtime: number; policy: MemoryPolicy } | null = null;

export function loadMemoryPolicy(): MemoryPolicy {
  if (!existsSync(MEMORY_YML)) return { ...DEFAULTS };

  try {
    const mtime = statSync(MEMORY_YML).mtimeMs;
    if (cached && cached.mtime === mtime) return cached.policy;

    const content = readFileSync(MEMORY_YML, "utf-8");
    const parsed = parseYaml(content) as { memory?: Partial<MemoryPolicy> } | null;
    const policy: MemoryPolicy = { ...DEFAULTS, ...(parsed?.memory ?? {}) };

    cached = { mtime, policy };
    return policy;
  } catch {
    return { ...DEFAULTS };
  }
}

/** DB 파일 크기를 MB 단위로 반환 (없으면 0) */
export function getDbSizeMb(dbPath: string): number {
  if (!existsSync(dbPath)) return 0;
  const bytes = statSync(dbPath).size;
  return Number((bytes / (1024 * 1024)).toFixed(2));
}

/**
 * 현재 호출 컨텍스트의 user_id를 반환합니다.
 *
 * 우선순위:
 *   1. 명시 파라미터 (호출자가 user_id를 전달한 경우)
 *   2. 환경변수 JARVIS_USER_ID (데몬이 spawn 시 주입)
 *   3. 기본값 "owner" (Owner 로컬 chat)
 *
 * 데몬은 외부 채널 요청을 처리할 때 spawn한 claude 자식 프로세스에
 * `JARVIS_USER_ID=slack:U123` 같은 환경변수를 주입합니다.
 * Claude Code가 spawn하는 MCP 서버는 그 환경변수를 상속하므로,
 * MCP 도구가 user_id를 명시받지 못해도 자동으로 올바른 유저로 분리됩니다.
 */
export function resolveUserId(explicit?: string): string {
  if (explicit && explicit.trim()) return explicit;
  const fromEnv = process.env.JARVIS_USER_ID;
  if (fromEnv && fromEnv.trim()) return fromEnv;
  return "owner";
}
