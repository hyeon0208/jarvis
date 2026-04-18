#!/usr/bin/env bun

/**
 * Jarvis Dreaming Cron
 *
 * - 미동기화 세션 로그를 SQLite 세션 테이블에 반영
 * - DreamingEngine을 통한 실제 메모리 정리 (중복 병합, 오래된 항목 아카이브)
 * - 30일 이상 오래된 세션 JSON 파일 정리
 *
 * 트리거:
 * 1) 수동: bun run ~/jarvis/hooks/dreaming-cron.js
 * 2) auto-memory.js 훅이 DB 크기 임계치 초과 시 백그라운드 spawn
 * 3) cron/launchd 정기 실행
 */

import fs from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { DreamingEngine } from "../packages/memory-server/src/dreaming.ts";
import { SessionStore } from "../packages/memory-server/src/session-search.ts";
import { loadMemoryPolicy, getDbSizeMb } from "../packages/memory-server/src/memory-config.ts";

const HOME = process.env.HOME || "~";
const SESSIONS_DIR = path.join(HOME, ".jarvis", "sessions");
const DB_PATH = path.join(HOME, ".jarvis", "data", "memory.db");

function syncSessionLogs(sessions) {
  if (!fs.existsSync(SESSIONS_DIR)) return 0;
  const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
  let synced = 0;

  for (const file of files) {
    try {
      const filePath = path.join(SESSIONS_DIR, file);
      const session = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (session.synced) continue;

      sessions.startSession(session.session_id, "owner");
      sessions.endSession(
        session.session_id,
        `도구 ${session.tool_count}회, 파일 ${session.file_changes}건 변경. 수정 파일: ${(session.files_modified || []).join(", ")}`,
        session.tool_count ?? 0,
        session.file_changes ?? 0,
      );

      session.synced = true;
      session.synced_at = new Date().toISOString();
      fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
      synced++;
    } catch {
      // 개별 파일 실패 무시
    }
  }
  return synced;
}

function cleanOldSessionFiles(days = 30) {
  if (!fs.existsSync(SESSIONS_DIR)) return 0;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(SESSIONS_DIR);
  let cleaned = 0;

  for (const file of files) {
    try {
      const filePath = path.join(SESSIONS_DIR, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        cleaned++;
      }
    } catch {
      // 무시
    }
  }
  return cleaned;
}

function main() {
  console.log("[Jarvis Dreaming] 시작...");
  const policy = loadMemoryPolicy();
  const sizeBeforeMb = getDbSizeMb(DB_PATH);
  console.log(
    `[Jarvis Dreaming] DB 크기: ${sizeBeforeMb} MB / soft ${policy.soft_limit_mb} MB / hard ${policy.hard_limit_mb} MB`,
  );

  if (!fs.existsSync(DB_PATH)) {
    console.log("[Jarvis Dreaming] DB 없음, 종료");
    return;
  }

  const db = new Database(DB_PATH);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");

  const sessions = new SessionStore(db);
  const dreaming = new DreamingEngine(db);

  // 1) 세션 로그 → DB 동기화
  const syncedCount = syncSessionLogs(sessions);
  console.log(`[Jarvis Dreaming] 세션 로그 동기화: ${syncedCount}건`);

  // 2) 실제 Dreaming (memory.yml의 archive_days 자동 적용; hard 초과 시 더 짧게)
  const aggressive = sizeBeforeMb >= policy.hard_limit_mb;
  const staleDays = aggressive
    ? Math.max(7, Math.floor(policy.archive_days / 2))
    : undefined;
  const report = dreaming.dream("owner", staleDays);
  console.log(
    `[Jarvis Dreaming] 정리 완료: 중복 병합 ${report.duplicates_merged}건, 아카이브 ${report.stale_archived}건${aggressive ? " (hard 초과 → 공격적 정리)" : ""}`,
  );

  // 3) 오래된 세션 JSON 파일 정리
  const cleanedCount = cleanOldSessionFiles(policy.archive_days);
  console.log(`[Jarvis Dreaming] 오래된 로그 정리: ${cleanedCount}건`);

  db.close();
  const sizeAfterMb = getDbSizeMb(DB_PATH);
  console.log(`[Jarvis Dreaming] DB 크기 (정리 후): ${sizeAfterMb} MB`);
}

try {
  main();
} catch (err) {
  console.error(`[Jarvis Dreaming] 실패: ${err?.message ?? err}`);
  process.exit(1);
}
