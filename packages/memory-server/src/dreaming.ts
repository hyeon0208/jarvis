import type { Database } from "bun:sqlite";
import { DeclarativeMemoryStore } from "./declarative.js";
import { loadMemoryPolicy } from "./memory-config.js";

export interface DreamingReport {
  duplicates_merged: number;
  stale_archived: number;
  total_affected: number;
  actions: string[];
}

export class DreamingEngine {
  private readonly declarative: DeclarativeMemoryStore;

  constructor(private readonly db: Database) {
    this.declarative = new DeclarativeMemoryStore(db);
  }

  /** 전체 Dreaming 사이클 실행 — staleDays 미지정 시 memory.yml의 archive_days 사용 */
  dream(userId = "owner", staleDays?: number): DreamingReport {
    const days = staleDays ?? loadMemoryPolicy().archive_days;
    return this.dreamWithDays(userId, days);
  }

  private dreamWithDays(userId: string, staleDays: number): DreamingReport {
    const actions: string[] = [];
    let totalAffected = 0;

    // 1. 중복 메모리 병합
    const duplicatesMerged = this.mergeDuplicates(userId, actions);
    totalAffected += duplicatesMerged;

    // 2. 오래된 메모리 아카이브
    const staleArchived = this.archiveStale(userId, staleDays, actions);
    totalAffected += staleArchived;

    // 3. Dreaming 로그 기록
    this.logDreaming("full_cycle", actions.join("; "), totalAffected);

    return {
      duplicates_merged: duplicatesMerged,
      stale_archived: staleArchived,
      total_affected: totalAffected,
      actions,
    };
  }

  /** 같은 key를 가진 메모리를 최신 것으로 병합 */
  private mergeDuplicates(userId: string, actions: string[]): number {
    const duplicates = this.declarative.findDuplicates(userId);
    let merged = 0;

    for (const { key, count } of duplicates) {
      // 같은 key의 메모리들을 가져와서 가장 최신 것만 남기고 아카이브
      const rows = this.db
        .query(
          `SELECT id FROM declarative_memory
           WHERE key = ? AND user_id = ? AND archived = 0
           ORDER BY updated_at DESC`,
        )
        .all(key, userId) as Array<{ id: number }>;

      // 첫 번째(최신)를 제외하고 아카이브
      for (let i = 1; i < rows.length; i++) {
        this.declarative.archive(rows[i].id);
        merged++;
      }

      actions.push(`중복 병합: "${key}" (${count}개 → 1개)`);
    }

    return merged;
  }

  /** 오래된 메모리 아카이브 */
  private archiveStale(
    userId: string,
    days: number,
    actions: string[],
  ): number {
    const staleMemories = this.declarative.findStale(days, userId);

    for (const mem of staleMemories) {
      this.declarative.archive(mem.id);
    }

    if (staleMemories.length > 0) {
      actions.push(
        `오래된 메모리 아카이브: ${staleMemories.length}건 (${days}일 이상)`,
      );
    }

    return staleMemories.length;
  }

  /** Dreaming 로그 기록 */
  private logDreaming(
    action: string,
    details: string,
    affected: number,
  ): void {
    this.db.run(
      "INSERT INTO dreaming_log (action, details, memories_affected) VALUES (?, ?, ?)",
      [action, details, affected],
    );
  }

  /** Dreaming 히스토리 조회 */
  history(limit = 10): Array<{
    action: string;
    details: string;
    memories_affected: number;
    executed_at: string;
  }> {
    return this.db
      .query(
        "SELECT * FROM dreaming_log ORDER BY executed_at DESC LIMIT ?",
      )
      .all(limit) as Array<{
      action: string;
      details: string;
      memories_affected: number;
      executed_at: string;
    }>;
  }
}
