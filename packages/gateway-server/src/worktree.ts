import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const WORKTREES_DIR = ".jarvis-worktrees";

/**
 * 멤버별 Git Worktree 관리
 *
 * 각 멤버에게 독립된 작업 디렉토리를 제공하여
 * 브랜치 충돌 없이 동시 작업이 가능하게 합니다.
 *
 * 구조:
 *   ~/project/                          ← 메인 (Owner)
 *   ~/project/.jarvis-worktrees/
 *     ├── telegram_1111/                ← 멤버 A 전용
 *     └── discord_2222/                 ← 멤버 B 전용
 */

/** 유저 ID를 안전한 디렉토리명으로 변환 */
function toSafeDirName(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9]/g, "_");
}

/** 프로젝트의 git root 찾기 */
export function findGitRoot(dir: string): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd: dir,
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
}

/** 멤버 전용 worktree 경로 반환 */
export function getWorktreePath(projectDir: string, userId: string): string {
  return join(projectDir, WORKTREES_DIR, toSafeDirName(userId));
}

/** 멤버 전용 worktree 생성 또는 기존 반환 */
export function ensureWorktree(
  projectDir: string,
  userId: string,
): { path: string; branch: string; created: boolean } {
  const gitRoot = findGitRoot(projectDir);
  if (!gitRoot) {
    // git repo가 아니면 프로젝트 디렉토리 그대로 반환
    return { path: projectDir, branch: "none", created: false };
  }

  const worktreePath = getWorktreePath(gitRoot, userId);
  const safeName = toSafeDirName(userId);
  const branchName = `jarvis/${safeName}`;

  // 이미 존재하면 최신화 후 반환
  if (existsSync(worktreePath)) {
    const currentBranch = getCurrentBranch(worktreePath);
    syncWorktree(gitRoot, worktreePath);
    return { path: worktreePath, branch: currentBranch, created: false };
  }

  // worktrees 디렉토리 생성
  const worktreesDir = join(gitRoot, WORKTREES_DIR);
  if (!existsSync(worktreesDir)) {
    mkdirSync(worktreesDir, { recursive: true });
    // .gitignore에 추가 (메인 repo에 worktree 파일이 추적되지 않도록)
    try {
      const gitignorePath = join(gitRoot, ".gitignore");
      const { readFileSync, appendFileSync } = require("node:fs");
      const content = existsSync(gitignorePath)
        ? readFileSync(gitignorePath, "utf-8")
        : "";
      if (!content.includes(WORKTREES_DIR)) {
        appendFileSync(gitignorePath, `\n${WORKTREES_DIR}/\n`);
      }
    } catch {
      // .gitignore 업데이트 실패는 무시
    }
  }

  // 기본 브랜치에서 pull 후 worktree 생성
  try {
    const defaultBranch = getDefaultBranch(gitRoot);

    // 최신 상태로 pull
    execSync(`git pull origin ${defaultBranch} --ff-only`, {
      cwd: gitRoot,
      encoding: "utf-8",
      stdio: "pipe",
    });

    // 브랜치가 이미 있으면 재사용, 없으면 생성
    const branchExists = checkBranchExists(gitRoot, branchName);

    if (branchExists) {
      execSync(`git worktree add "${worktreePath}" ${branchName}`, {
        cwd: gitRoot,
        encoding: "utf-8",
        stdio: "pipe",
      });
    } else {
      execSync(
        `git worktree add -b ${branchName} "${worktreePath}" ${defaultBranch}`,
        {
          cwd: gitRoot,
          encoding: "utf-8",
          stdio: "pipe",
        },
      );
    }

    return { path: worktreePath, branch: branchName, created: true };
  } catch (err) {
    // worktree 생성 실패 시 프로젝트 디렉토리 반환
    return { path: projectDir, branch: "fallback", created: false };
  }
}

/** worktree 삭제 */
export function removeWorktree(projectDir: string, userId: string): boolean {
  const gitRoot = findGitRoot(projectDir);
  if (!gitRoot) return false;

  const worktreePath = getWorktreePath(gitRoot, userId);
  if (!existsSync(worktreePath)) return false;

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

/** 모든 jarvis worktree 목록 */
export function listWorktrees(projectDir: string): Array<{
  path: string;
  branch: string;
  userId: string;
}> {
  const gitRoot = findGitRoot(projectDir);
  if (!gitRoot) return [];

  try {
    const output = execSync("git worktree list --porcelain", {
      cwd: gitRoot,
      encoding: "utf-8",
      stdio: "pipe",
    });

    const worktrees: Array<{ path: string; branch: string; userId: string }> = [];

    const blocks = output.split("\n\n");
    for (const block of blocks) {
      const lines = block.trim().split("\n");
      const pathLine = lines.find((l) => l.startsWith("worktree "));
      const branchLine = lines.find((l) => l.startsWith("branch "));

      if (!pathLine || !branchLine) continue;

      const wtPath = pathLine.replace("worktree ", "");
      const branch = branchLine.replace("branch refs/heads/", "");

      // jarvis/ 접두사 브랜치만 필터
      if (!branch.startsWith("jarvis/")) continue;

      const userId = branch
        .replace("jarvis/", "")
        .replace(/_/g, ":");

      worktrees.push({ path: wtPath, branch, userId });
    }

    return worktrees;
  } catch {
    return [];
  }
}

/**
 * worktree를 dev/main 최신 상태로 동기화
 *
 * 1. git fetch origin (원격 최신 커밋 가져오기)
 * 2. git rebase origin/{default_branch} (최신 변경사항 반영)
 *    - 충돌 시 rebase 취소하고 merge로 대체 시도
 */
export function syncWorktree(gitRoot: string, worktreePath: string): void {
  try {
    const defaultBranch = getDefaultBranch(gitRoot);

    // 원격에서 최신 커밋 가져오기
    execSync("git fetch origin", {
      cwd: worktreePath,
      encoding: "utf-8",
      stdio: "pipe",
    });

    // rebase로 최신화 시도
    try {
      execSync(`git rebase origin/${defaultBranch}`, {
        cwd: worktreePath,
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch {
      // rebase 충돌 시 취소 후 merge로 대체
      try {
        execSync("git rebase --abort", {
          cwd: worktreePath,
          stdio: "pipe",
        });
      } catch { /* 이미 취소된 경우 무시 */ }

      try {
        execSync(`git merge origin/${defaultBranch} --no-edit`, {
          cwd: worktreePath,
          encoding: "utf-8",
          stdio: "pipe",
        });
      } catch {
        // merge도 실패하면 포기 (현재 상태 유지)
        try {
          execSync("git merge --abort", {
            cwd: worktreePath,
            stdio: "pipe",
          });
        } catch { /* ignore */ }
      }
    }
  } catch {
    // fetch 실패 (네트워크 등) → 현재 상태 유지
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
    // fallback: main 또는 dev 확인
    try {
      execSync("git rev-parse --verify dev", {
        cwd: gitRoot,
        stdio: "pipe",
      });
      return "dev";
    } catch {
      return "main";
    }
  }
}

function getCurrentBranch(dir: string): string {
  try {
    return execSync("git branch --show-current", {
      cwd: dir,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
  } catch {
    return "unknown";
  }
}

function checkBranchExists(gitRoot: string, branchName: string): boolean {
  try {
    execSync(`git rev-parse --verify ${branchName}`, {
      cwd: gitRoot,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}
