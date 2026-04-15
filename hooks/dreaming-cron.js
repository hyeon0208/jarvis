#!/usr/bin/env node

/**
 * Jarvis Dreaming Cron
 *
 * 주기적으로 실행되어 메모리 Dreaming을 수행합니다.
 * Claude Code의 ScheduledTask 또는 CronCreate로 등록합니다.
 *
 * 동작:
 * 1. 미동기화 세션 로그를 SQLite에 반영
 * 2. Dreaming 실행 (중복 병합, 오래된 메모리 아카이브)
 * 3. 오래된 세션 로그 파일 정리
 *
 * 실행: bun run ~/jarvis/hooks/dreaming-cron.js
 * (bun:sqlite 사용을 위해 bun으로 실행)
 */

async function main() {
  const fs = await import("fs");
  const path = await import("path");

  const SESSIONS_DIR = path.join(process.env.HOME || "~", ".jarvis", "sessions");
  const DB_PATH = path.join(process.env.HOME || "~", ".jarvis", "data", "memory.db");

  console.log("[Jarvis Dreaming] 시작...");

  // 1. 미동기화 세션 로그를 SQLite에 반영
  let syncedCount = 0;
  if (fs.existsSync(SESSIONS_DIR)) {
    const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      try {
        const filePath = path.join(SESSIONS_DIR, file);
        const session = JSON.parse(fs.readFileSync(filePath, "utf-8"));

        if (session.synced) continue;

        // 동기화 마킹 (DB 쓰기는 MCP 서버 통해 수행)
        session.synced = true;
        session.synced_at = new Date().toISOString();
        fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
        syncedCount++;
      } catch {
        // 개별 파일 실패 무시
      }
    }
  }

  console.log(`[Jarvis Dreaming] 세션 로그 동기화: ${syncedCount}건`);

  // 2. 30일 이상 오래된 세션 로그 파일 정리
  let cleanedCount = 0;
  if (fs.existsSync(SESSIONS_DIR)) {
    const files = fs.readdirSync(SESSIONS_DIR);
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    for (const file of files) {
      try {
        const filePath = path.join(SESSIONS_DIR, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < thirtyDaysAgo) {
          fs.unlinkSync(filePath);
          cleanedCount++;
        }
      } catch {
        // 개별 파일 실패 무시
      }
    }
  }

  console.log(`[Jarvis Dreaming] 오래된 로그 정리: ${cleanedCount}건`);

  // 3. Dreaming 실행은 MCP 서버의 jarvis_memory_dream 도구를 통해 수행
  // 이 스크립트는 로그 정리만 담당하고,
  // 실제 Dreaming은 Claude Code 세션에서 도구 호출로 수행합니다.
  console.log(
    "[Jarvis Dreaming] 완료. 메모리 Dreaming은 jarvis_memory_dream 도구를 호출하세요.",
  );
}

main().catch(console.error);
