import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const WORKTREES_DIR = ".jarvis-worktrees";

/**
 * 작업별 Git Worktree 관리
 *
 * 매 요청마다 dev/main에서 pull 후 새 브랜치+워크트리를 생성합니다.
 * 작업 완료 후 commit/push가 끝나면 자동 정리됩니다.
 *
 * 구조:
 *   ~/project/.jarvis-worktrees/
 *     ├── telegram_1111_1713264000/    ← 멤버 A의 작업 1
 *     ├── telegram_1111_1713264060/    ← 멤버 A의 작업 2
 *     └── discord_2222_1713264100/     ← 멤버 B의 작업 1
 */

/** 유저 ID를 안전한 디렉토리명으로 변환 */
function toSafeName(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9]/g, "_");
}

/** 프로젝트의 git root 찾기 */
export function findGitRoot(dir: string): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd: dir,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
  } catch {
    return null;
  }
}

/**
 * 새 작업용 worktree 생성
 *
 * 1. git fetch origin
 * 2. dev/main 최신 상태 확인
 * 3. 새 브랜치 생성 (jarvis/{user}/{timestamp})
 * 4. 해당 브랜치로 worktree 생성
 */
export function createTaskWorktree(
  projectDir: string,
  userId: string,
): { path: string; branch: string; created: boolean } {
  const gitRoot = findGitRoot(projectDir);
  if (!gitRoot) {
    return { path: projectDir, branch: "none", created: false };
  }

  const safeName = toSafeName(userId);
  const timestamp = Math.floor(Date.now() / 1000);
  const dirName = `${safeName}_${timestamp}`;
  const branchName = `jarvis/${safeName}/${timestamp}`;
  const worktreePath = join(gitRoot, WORKTREES_DIR, dirName);

  // worktrees 디렉토리 + .gitignore 설정
  ensureWorktreesDir(gitRoot);

  try {
    const defaultBranch = getDefaultBranch(gitRoot);

    // 원격 최신 커밋 가져오기
    execSync("git fetch origin", {
      cwd: gitRoot,
      encoding: "utf-8",
      stdio: "pipe",
    });

    // 최신 dev/main에서 새 브랜치+워크트리 생성
    execSync(
      `git worktree add -b ${branchName} "${worktreePath}" origin/${defaultBranch}`,
      {
        cwd: gitRoot,
        encoding: "utf-8",
        stdio: "pipe",
      },
    );

    return { path: worktreePath, branch: branchName, created: true };
  } catch (err) {
    return { path: projectDir, branch: "fallback", created: false };
  }
}

/** 완료된 worktree 정리 */
export function cleanupWorktree(projectDir: string, worktreePath: string): boolean {
  const gitRoot = findGitRoot(projectDir);
  if (!gitRoot) return false;

  try {
    execSync(`git worktree remove "${worktreePath}" --force`, {
      cwd: gitRoot,
      encoding: "utf-8",
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/** 오래된 worktree 일괄 정리 (기본 24시간 이상) */
export function cleanupOldWorktrees(
  projectDir: string,
  maxAgeHours = 24,
): number {
  const gitRoot = findGitRoot(projectDir);
  if (!gitRoot) return 0;

  const worktreesDir = join(gitRoot, WORKTREES_DIR);
  if (!existsSync(worktreesDir)) return 0;

  let cleaned = 0;
  const now = Math.floor(Date.now() / 1000);
  const maxAgeSec = maxAgeHours * 60 * 60;

  try {
    const { readdirSync } = require("node:fs");
    const dirs = readdirSync(worktreesDir) as string[];

    for (const dir of dirs) {
      // 디렉토리명에서 timestamp 추출 (마지막 _이후 숫자)
      const match = dir.match(/_(\d+)$/);
      if (!match) continue;

      const created = Number(match[1]);
      if (now - created > maxAgeSec) {
        const wtPath = join(worktreesDir, dir);
        if (cleanupWorktree(projectDir, wtPath)) {
          cleaned++;
        }
      }
    }
  } catch {
    // 정리 실패 무시
  }

  return cleaned;
}

/** 활성 worktree 목록 */
export function listWorktrees(projectDir: string): Array<{
  path: string;
  branch: string;
  userId: string;
  createdAt: string;
}> {
  const gitRoot = findGitRoot(projectDir);
  if (!gitRoot) return [];

  try {
    const output = execSync("git worktree list --porcelain", {
      cwd: gitRoot,
      encoding: "utf-8",
      stdio: "pipe",
    });

    const results: Array<{
      path: string;
      branch: string;
      userId: string;
      createdAt: string;
    }> = [];

    const blocks = output.split("\n\n");
    for (const block of blocks) {
      const lines = block.trim().split("\n");
      const pathLine = lines.find((l) => l.startsWith("worktree "));
      const branchLine = lines.find((l) => l.startsWith("branch "));

      if (!pathLine || !branchLine) continue;

      const wtPath = pathLine.replace("worktree ", "");
      const branch = branchLine.replace("branch refs/heads/", "");

      if (!branch.startsWith("jarvis/")) continue;

      // jarvis/{user}/{timestamp} → userId, timestamp 추출
      const parts = branch.split("/");
      const userId = (parts[1] ?? "").replace(/_/g, ":");
      const ts = parts[2] ?? "";
      const createdAt = ts
        ? new Date(Number(ts) * 1000).toISOString()
        : "unknown";

      results.push({ path: wtPath, branch, userId, createdAt });
    }

    return results;
  } catch {
    return [];
  }
}

// --- 내부 함수 ---

function ensureWorktreesDir(gitRoot: string): void {
  const worktreesDir = join(gitRoot, WORKTREES_DIR);
  if (!existsSync(worktreesDir)) {
    mkdirSync(worktreesDir, { recursive: true });
  }

  // .gitignore에 추가
  try {
    const gitignorePath = join(gitRoot, ".gitignore");
    const content = existsSync(gitignorePath)
      ? readFileSync(gitignorePath, "utf-8")
      : "";
    if (!content.includes(WORKTREES_DIR)) {
      appendFileSync(gitignorePath, `\n${WORKTREES_DIR}/\n`);
    }
  } catch {
    // 실패 무시
  }
}

function getDefaultBranch(gitRoot: string): string {
  try {
    const ref = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
      cwd: gitRoot,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
    return ref.replace("refs/remotes/origin/", "");
  } catch {
    try {
      execSync("git rev-parse --verify origin/dev", {
        cwd: gitRoot,
        stdio: "pipe",
      });
      return "dev";
    } catch {
      return "main";
    }
  }
}
