import type { Database } from "bun:sqlite";

export interface DeclarativeMemory {
  id: number;
  key: string;
  content: string;
  tags: string[];
  user_id: string;
  created_at: string;
  updated_at: string;
  archived: boolean;
}

interface DeclarativeRow {
  id: number;
  key: string;
  content: string;
  tags: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  archived: number;
}

function rowToMemory(row: DeclarativeRow): DeclarativeMemory {
  return {
    ...row,
    tags: JSON.parse(row.tags) as string[],
    archived: row.archived === 1,
  };
}

export class DeclarativeMemoryStore {
  constructor(private readonly db: Database) {}

  save(
    key: string,
    content: string,
    tags: string[] = [],
    userId = "owner",
  ): DeclarativeMemory {
    // UPSERT: 같은 key+user_id 조합이 있으면 업데이트
    const existing = this.db
      .query(
        "SELECT id FROM declarative_memory WHERE key = ? AND user_id = ? AND archived = 0",
      )
      .get(key, userId) as { id: number } | null;

    if (existing) {
      this.db.run(
        `UPDATE declarative_memory
         SET content = ?, tags = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [content, JSON.stringify(tags), existing.id],
      );
      return this.getById(existing.id)!;
    }

    const result = this.db.run(
      `INSERT INTO declarative_memory (key, content, tags, user_id)
       VALUES (?, ?, ?, ?)`,
      [key, content, JSON.stringify(tags), userId],
    );

    return this.getById(Number(result.lastInsertRowid))!;
  }

  search(query: string, userId?: string, limit = 5): DeclarativeMemory[] {
    let sql: string;
    const params: unknown[] = [];

    if (userId) {
      sql = `
        SELECT dm.* FROM declarative_memory dm
        JOIN declarative_memory_fts fts ON dm.id = fts.rowid
        WHERE declarative_memory_fts MATCH ? AND dm.user_id = ? AND dm.archived = 0
        ORDER BY rank
        LIMIT ?
      `;
      params.push(query, userId, limit);
    } else {
      sql = `
        SELECT dm.* FROM declarative_memory dm
        JOIN declarative_memory_fts fts ON dm.id = fts.rowid
        WHERE declarative_memory_fts MATCH ? AND dm.archived = 0
        ORDER BY rank
        LIMIT ?
      `;
      params.push(query, limit);
    }

    const rows = this.db.query(sql).all(...params) as DeclarativeRow[];
    return rows.map(rowToMemory);
  }

  getByKey(key: string, userId = "owner"): DeclarativeMemory | null {
    const row = this.db
      .query(
        "SELECT * FROM declarative_memory WHERE key = ? AND user_id = ? AND archived = 0",
      )
      .get(key, userId) as DeclarativeRow | null;
    return row ? rowToMemory(row) : null;
  }

  listByUser(userId = "owner", limit = 50): DeclarativeMemory[] {
    const rows = this.db
      .query(
        `SELECT * FROM declarative_memory
         WHERE user_id = ? AND archived = 0
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(userId, limit) as DeclarativeRow[];
    return rows.map(rowToMemory);
  }

  archive(id: number): void {
    this.db.run(
      "UPDATE declarative_memory SET archived = 1, updated_at = datetime('now') WHERE id = ?",
      [id],
    );
  }

  delete(id: number): void {
    this.db.run("DELETE FROM declarative_memory WHERE id = ?", [id]);
  }

  /** Dreaming용: 중복 키 탐지 */
  findDuplicates(userId = "owner"): Array<{ key: string; count: number }> {
    return this.db
      .query(
        `SELECT key, COUNT(*) as count FROM declarative_memory
         WHERE user_id = ? AND archived = 0
         GROUP BY key HAVING count > 1`,
      )
      .all(userId) as Array<{ key: string; count: number }>;
  }

  /** Dreaming용: 오래된 메모리 조회 */
  findStale(daysOld: number, userId = "owner"): DeclarativeMemory[] {
    const rows = this.db
      .query(
        `SELECT * FROM declarative_memory
         WHERE user_id = ? AND archived = 0
         AND updated_at < datetime('now', '-' || ? || ' days')
         ORDER BY updated_at ASC`,
      )
      .all(userId, daysOld) as DeclarativeRow[];
    return rows.map(rowToMemory);
  }

  count(userId?: string): number {
    if (userId) {
      const row = this.db
        .query(
          "SELECT COUNT(*) as c FROM declarative_memory WHERE user_id = ? AND archived = 0",
        )
        .get(userId) as { c: number };
      return row.c;
    }
    const row = this.db
      .query(
        "SELECT COUNT(*) as c FROM declarative_memory WHERE archived = 0",
      )
      .get() as { c: number };
    return row.c;
  }

  private getById(id: number): DeclarativeMemory | null {
    const row = this.db
      .query("SELECT * FROM declarative_memory WHERE id = ?")
      .get(id) as DeclarativeRow | null;
    return row ? rowToMemory(row) : null;
  }
}
