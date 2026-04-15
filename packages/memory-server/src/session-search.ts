import type { Database } from "bun:sqlite";

export interface Session {
  id: number;
  session_id: string;
  user_id: string;
  summary: string | null;
  tool_count: number;
  file_changes: number;
  started_at: string;
  ended_at: string | null;
  tags: string[];
}

export interface SessionMessage {
  id: number;
  session_id: string;
  role: string;
  content: string;
  timestamp: string;
}

interface SessionRow {
  id: number;
  session_id: string;
  user_id: string;
  summary: string | null;
  tool_count: number;
  file_changes: number;
  started_at: string;
  ended_at: string | null;
  tags: string;
}

interface SearchResult {
  session_id: string;
  summary: string | null;
  user_id: string;
  started_at: string;
  matched_content: string;
  rank: number;
}

export class SessionStore {
  constructor(private readonly db: Database) {}

  /** 새 세션 시작 */
  startSession(sessionId: string, userId = "owner"): Session {
    this.db.run(
      "INSERT OR IGNORE INTO sessions (session_id, user_id) VALUES (?, ?)",
      [sessionId, userId],
    );
    return this.getSession(sessionId)!;
  }

  /** 세션 종료 (요약 포함) */
  endSession(sessionId: string, summary: string, toolCount: number, fileChanges: number): void {
    this.db.run(
      `UPDATE sessions
       SET summary = ?, tool_count = ?, file_changes = ?, ended_at = datetime('now')
       WHERE session_id = ?`,
      [summary, toolCount, fileChanges, sessionId],
    );
  }

  /** 세션에 메시지 추가 */
  addMessage(sessionId: string, role: string, content: string): void {
    this.db.run(
      "INSERT INTO session_messages (session_id, role, content) VALUES (?, ?, ?)",
      [sessionId, role, content],
    );
  }

  /** FTS5로 과거 세션 검색 */
  search(query: string, limit = 3): SearchResult[] {
    return this.db
      .query(
        `SELECT
          sm.session_id,
          s.summary,
          s.user_id,
          s.started_at,
          snippet(session_messages_fts, 0, '>>>', '<<<', '...', 64) as matched_content,
          rank
        FROM session_messages_fts fts
        JOIN session_messages sm ON sm.id = fts.rowid
        JOIN sessions s ON s.session_id = sm.session_id
        WHERE session_messages_fts MATCH ?
        ORDER BY rank
        LIMIT ?`,
      )
      .all(query, limit) as SearchResult[];
  }

  /** 최근 세션 목록 */
  listRecent(limit = 10, userId?: string): Session[] {
    let sql: string;
    const params: unknown[] = [];

    if (userId) {
      sql = `SELECT * FROM sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT ?`;
      params.push(userId, limit);
    } else {
      sql = `SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?`;
      params.push(limit);
    }

    const rows = this.db.query(sql).all(...params) as SessionRow[];
    return rows.map((row) => ({
      ...row,
      tags: JSON.parse(row.tags) as string[],
    }));
  }

  getSession(sessionId: string): Session | null {
    const row = this.db
      .query("SELECT * FROM sessions WHERE session_id = ?")
      .get(sessionId) as SessionRow | null;
    if (!row) return null;
    return { ...row, tags: JSON.parse(row.tags) as string[] };
  }

  getMessages(sessionId: string): SessionMessage[] {
    return this.db
      .query(
        "SELECT * FROM session_messages WHERE session_id = ? ORDER BY timestamp ASC",
      )
      .all(sessionId) as SessionMessage[];
  }

  sessionCount(): number {
    const row = this.db
      .query("SELECT COUNT(*) as c FROM sessions")
      .get() as { c: number };
    return row.c;
  }

  messageCount(): number {
    const row = this.db
      .query("SELECT COUNT(*) as c FROM session_messages")
      .get() as { c: number };
    return row.c;
  }
}
