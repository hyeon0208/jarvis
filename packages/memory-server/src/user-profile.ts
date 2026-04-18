import type { Database } from "bun:sqlite";

export interface UserProfile {
  user_id: string;
  name: string | null;
  profile: string;
  channel: string | null;
  paired: boolean;
  paired_at: string | null;
  personality: Personality;
  preferences: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Personality {
  tone: "formal" | "casual" | "friendly" | "technical";
  language: string;
  verbosity: "concise" | "normal" | "detailed";
  emoji: boolean;
  nickname: string;
}

interface ProfileRow {
  user_id: string;
  name: string | null;
  profile: string;
  channel: string | null;
  paired: number;
  paired_at: string | null;
  personality: string;
  preferences: string;
  created_at: string;
  updated_at: string;
}

const DEFAULT_PERSONALITY: Personality = {
  tone: "friendly",
  language: "ko",
  verbosity: "normal",
  emoji: false,
  nickname: "Jarvis",
};

function rowToProfile(row: ProfileRow): UserProfile {
  return {
    ...row,
    paired: row.paired === 1,
    personality: JSON.parse(row.personality) as Personality,
    preferences: JSON.parse(row.preferences) as Record<string, unknown>,
  };
}

export class UserProfileStore {
  constructor(private readonly db: Database) {}

  /** 새 유저 등록 */
  create(userId: string, channel: string, name?: string): UserProfile {
    this.db.run(
      `INSERT OR IGNORE INTO user_profiles (user_id, name, channel, personality)
       VALUES (?, ?, ?, ?)`,
      [userId, name ?? null, channel, JSON.stringify(DEFAULT_PERSONALITY)],
    );
    return this.get(userId)!;
  }

  /** 유저 프로파일 조회 */
  get(userId: string): UserProfile | null {
    const row = this.db
      .query("SELECT * FROM user_profiles WHERE user_id = ?")
      .get(userId) as ProfileRow | null;
    return row ? rowToProfile(row) : null;
  }

  /** Owner 프로파일 조회/생성 */
  getOwner(): UserProfile {
    const existing = this.get("owner");
    if (existing) return existing;

    this.db.run(
      `INSERT INTO user_profiles (user_id, name, profile, personality, preferences)
       VALUES ('owner', 'Owner', 'owner', ?, '{}')`,
      [JSON.stringify(DEFAULT_PERSONALITY)],
    );
    return this.get("owner")!;
  }

  /** 프로파일 업데이트 */
  update(
    userId: string,
    data: Partial<{
      name: string;
      profile: string;
      paired: boolean;
      personality: Partial<Personality>;
      preferences: Record<string, unknown>;
    }>,
  ): UserProfile | null {
    const current = this.get(userId);
    if (!current) return null;

    if (data.name !== undefined) {
      this.db.run(
        "UPDATE user_profiles SET name = ?, updated_at = datetime('now') WHERE user_id = ?",
        [data.name, userId],
      );
    }

    if (data.profile !== undefined) {
      this.db.run(
        "UPDATE user_profiles SET profile = ?, updated_at = datetime('now') WHERE user_id = ?",
        [data.profile, userId],
      );
    }

    if (data.paired !== undefined) {
      this.db.run(
        `UPDATE user_profiles
         SET paired = ?, paired_at = ?, updated_at = datetime('now')
         WHERE user_id = ?`,
        [data.paired ? 1 : 0, data.paired ? new Date().toISOString() : null, userId],
      );
    }

    if (data.personality) {
      const merged = { ...current.personality, ...data.personality };
      this.db.run(
        "UPDATE user_profiles SET personality = ?, updated_at = datetime('now') WHERE user_id = ?",
        [JSON.stringify(merged), userId],
      );
    }

    if (data.preferences) {
      const merged = { ...current.preferences, ...data.preferences };
      this.db.run(
        "UPDATE user_profiles SET preferences = ?, updated_at = datetime('now') WHERE user_id = ?",
        [JSON.stringify(merged), userId],
      );
    }

    return this.get(userId);
  }

  /** 전체 유저 목록 */
  listAll(): UserProfile[] {
    const rows = this.db
      .query("SELECT * FROM user_profiles ORDER BY created_at DESC")
      .all() as ProfileRow[];
    return rows.map(rowToProfile);
  }

  /** 프로필별 유저 목록 */
  listByProfile(profile: string): UserProfile[] {
    const rows = this.db
      .query("SELECT * FROM user_profiles WHERE profile = ?")
      .all(profile) as ProfileRow[];
    return rows.map(rowToProfile);
  }

  /** 페어링된 유저 수 */
  pairedCount(): number {
    const row = this.db
      .query("SELECT COUNT(*) as c FROM user_profiles WHERE paired = 1")
      .get() as { c: number };
    return row.c;
  }

  delete(userId: string): void {
    this.db.run("DELETE FROM user_profiles WHERE user_id = ?", [userId]);
  }
}
