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
