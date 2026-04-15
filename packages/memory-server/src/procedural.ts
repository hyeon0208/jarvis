import type { Database } from "bun:sqlite";

export interface ProceduralMemory {
  id: number;
  skill_name: string;
  skill_path: string;
  description: string;
  tags: string[];
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ProceduralRow {
  id: number;
  skill_name: string;
  skill_path: string;
  description: string;
  tags: string;
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToMemory(row: ProceduralRow): ProceduralMemory {
  return {
    ...row,
    tags: JSON.parse(row.tags) as string[],
  };
}

export class ProceduralMemoryStore {
  constructor(private readonly db: Database) {}

  /** 스킬을 인덱스에 등록 (이미 존재하면 업데이트) */
  register(
    skillName: string,
    skillPath: string,
    description: string,
    tags: string[] = [],
  ): ProceduralMemory {
    const existing = this.db
      .query("SELECT id FROM procedural_memory WHERE skill_name = ?")
      .get(skillName) as { id: number } | null;

    if (existing) {
      this.db.run(
        `UPDATE procedural_memory
         SET skill_path = ?, description = ?, tags = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [skillPath, description, JSON.stringify(tags), existing.id],
      );
      return this.getById(existing.id)!;
    }

    const result = this.db.run(
      `INSERT INTO procedural_memory (skill_name, skill_path, description, tags)
       VALUES (?, ?, ?, ?)`,
      [skillName, skillPath, description, JSON.stringify(tags)],
    );

    return this.getById(Number(result.lastInsertRowid))!;
  }

  /** FTS5로 스킬 검색 */
  search(query: string, limit = 5): ProceduralMemory[] {
    const rows = this.db
      .query(
        `SELECT pm.* FROM procedural_memory pm
         JOIN procedural_memory_fts fts ON pm.id = fts.rowid
         WHERE procedural_memory_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(query, limit) as ProceduralRow[];
    return rows.map(rowToMemory);
  }

  /** 사용 횟수 증가 */
  recordUsage(skillName: string): void {
    this.db.run(
      `UPDATE procedural_memory
       SET usage_count = usage_count + 1, last_used_at = datetime('now')
       WHERE skill_name = ?`,
      [skillName],
    );
  }

  /** 전체 스킬 목록 (사용 빈도순) */
  listAll(limit = 50): ProceduralMemory[] {
    const rows = this.db
      .query(
        `SELECT * FROM procedural_memory
         ORDER BY usage_count DESC, updated_at DESC
         LIMIT ?`,
      )
      .all(limit) as ProceduralRow[];
    return rows.map(rowToMemory);
  }

  getByName(skillName: string): ProceduralMemory | null {
    const row = this.db
      .query("SELECT * FROM procedural_memory WHERE skill_name = ?")
      .get(skillName) as ProceduralRow | null;
    return row ? rowToMemory(row) : null;
  }

  remove(skillName: string): void {
    this.db.run("DELETE FROM procedural_memory WHERE skill_name = ?", [
      skillName,
    ]);
  }

  count(): number {
    const row = this.db
      .query("SELECT COUNT(*) as c FROM procedural_memory")
      .get() as { c: number };
    return row.c;
  }

  private getById(id: number): ProceduralMemory | null {
    const row = this.db
      .query("SELECT * FROM procedural_memory WHERE id = ?")
      .get(id) as ProceduralRow | null;
    return row ? rowToMemory(row) : null;
  }
}
