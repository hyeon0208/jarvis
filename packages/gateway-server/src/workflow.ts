import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const WORKFLOWS_DIR = join(process.env.HOME ?? "~", ".jarvis", "workflows");
const PROJECTS_FILE = join(process.env.HOME ?? "~", "jarvis", "config", "projects.jsonc");

// --- 타입 ---

export type WorkflowState =
  | "idle"
  | "awaiting_project"
  | "awaiting_mode"
  | "working"
  | "done";

export interface ProjectConfig {
  name: string;
  path: string;
  parent_branch: string;
  repo?: string;
  allowed_profiles: string[];
  branch_prefix: string;
}

export interface WorkflowSession {
  state: WorkflowState;
  task: string;
  project_key: string | null;
  project: ProjectConfig | null;
  mode: "issue" | "branch" | null;
  worktree_path: string | null;
  branch: string | null;
  issue_number: number | null;
  started_at: string;
  updated_at: string;
}

// --- 프로젝트 설정 ---

function parseJsonc(content: string): unknown {
  return JSON.parse(
    content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""),
  );
}

export function loadProjects(): Record<string, ProjectConfig> {
  if (!existsSync(PROJECTS_FILE)) return {};
  try {
    const content = readFileSync(PROJECTS_FILE, "utf-8");
    const config = parseJsonc(content) as { projects: Record<string, ProjectConfig> };
    return config.projects;
  } catch {
    return {};
  }
}

/** 프로필이 접근 가능한 프로젝트 목록 */
export function getAccessibleProjects(
  profileName: string,
): Array<{ key: string; config: ProjectConfig }> {
  const projects = loadProjects();
  return Object.entries(projects)
    .filter(([, config]) => config.allowed_profiles.includes(profileName))
    .map(([key, config]) => ({ key, config }));
}

// --- 워크플로우 세션 ---

function ensureDir(): void {
  if (!existsSync(WORKFLOWS_DIR)) mkdirSync(WORKFLOWS_DIR, { recursive: true });
}

function sessionPath(userId: string): string {
  return join(WORKFLOWS_DIR, `${userId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
}

export function getWorkflow(userId: string): WorkflowSession | null {
  const path = sessionPath(userId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function saveWorkflow(userId: string, session: WorkflowSession): void {
  ensureDir();
  session.updated_at = new Date().toISOString();
  writeFileSync(sessionPath(userId), JSON.stringify(session, null, 2));
}

function clearWorkflow(userId: string): void {
  const path = sessionPath(userId);
  if (existsSync(path)) {
    const { unlinkSync } = require("node:fs");
    unlinkSync(path);
  }
}

// --- 워크플로우 핸들러 ---

/** /dev 커맨드 시작 */
export function startWorkflow(
  userId: string,
  profileName: string,
  task: string,
): string {
  const projects = getAccessibleProjects(profileName);

  if (projects.length === 0) {
    return "접근 가능한 프로젝트가 없습니다. 관리자에게 config/projects.jsonc 설정을 요청하세요.";
  }

  const session: WorkflowSession = {
    state: "awaiting_project",
    task,
    project_key: null,
    project: null,
    mode: null,
    worktree_path: null,
    branch: null,
    issue_number: null,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // 프로젝트가 1개면 자동 선택
  if (projects.length === 1) {
    session.project_key = projects[0].key;
    session.project = projects[0].config;
    session.state = "awaiting_mode";
    saveWorkflow(userId, session);

    return [
      `등록된 프로젝트가 1개뿐이라 자동 선택되었습니다.`,
      `프로젝트: ${projects[0].config.name}`,
      `작업: ${task}`,
      "",
      "어떻게 시작할까요?",
      "1. 이슈 생성 후 브랜치 생성",
      "2. 바로 브랜치 생성하여 개발 시작",
      "",
      "번호를 입력하세요. (취소: /dev cancel)",
    ].join("\n");
  }

  saveWorkflow(userId, session);

  const lines = [
    `작업: ${task}`,
    "",
    "어떤 프로젝트에서 작업할까요?",
  ];
  projects.forEach(({ key, config }, i) => {
    lines.push(`${i + 1}. ${config.name} (${key})`);
  });
  lines.push("", "번호를 입력하세요. (취소: /dev cancel)");

  return lines.join("\n");
}

/** 프로젝트 선택 처리 */
export function selectProject(
  userId: string,
  profileName: string,
  input: string,
): string {
  const session = getWorkflow(userId);
  if (!session || session.state !== "awaiting_project") {
    return "진행 중인 워크플로우가 없습니다.";
  }

  const projects = getAccessibleProjects(profileName);
  const index = Number(input.trim()) - 1;

  if (isNaN(index) || index < 0 || index >= projects.length) {
    return `1~${projects.length} 사이의 번호를 입력하세요. (취소: /dev cancel)`;
  }

  session.project_key = projects[index].key;
  session.project = projects[index].config;
  session.state = "awaiting_mode";
  saveWorkflow(userId, session);

  return [
    `프로젝트: ${session.project.name}`,
    `작업: ${session.task}`,
    "",
    "어떻게 시작할까요?",
    "1. 이슈 생성 후 브랜치 생성",
    "2. 바로 브랜치 생성하여 개발 시작",
    "",
    "번호를 입력하세요. (취소: /dev cancel)",
  ].join("\n");
}

/** 모드 선택 → 브랜치 생성 → 작업 시작 */
export function selectMode(
  userId: string,
  input: string,
): { response: string; readyToWork: boolean; workDir?: string; task?: string } {
  const session = getWorkflow(userId);
  if (!session || session.state !== "awaiting_mode" || !session.project) {
    return { response: "진행 중인 워크플로우가 없습니다.", readyToWork: false };
  }

  const choice = input.trim();
  if (choice !== "1" && choice !== "2") {
    return {
      response: "1 또는 2를 입력하세요. (취소: /dev cancel)",
      readyToWork: false,
    };
  }

  session.mode = choice === "1" ? "issue" : "branch";

  const project = session.project;
  const branchName = generateBranchName(project.branch_prefix, session.task);

  try {
    // 1. parent branch에서 pull
    execSync(`git fetch origin`, {
      cwd: project.path,
      stdio: "pipe",
    });
    execSync(`git checkout ${project.parent_branch}`, {
      cwd: project.path,
      stdio: "pipe",
    });
    execSync(`git pull origin ${project.parent_branch}`, {
      cwd: project.path,
      stdio: "pipe",
    });

    // 2. worktree 생성
    const safeName = userId.replace(/[^a-zA-Z0-9]/g, "_");
    const worktreeDir = join(project.path, ".jarvis-worktrees", safeName);

    // 기존 worktree 정리
    if (existsSync(worktreeDir)) {
      try {
        execSync(`git worktree remove "${worktreeDir}" --force`, {
          cwd: project.path,
          stdio: "pipe",
        });
      } catch { /* ignore */ }
    }

    // 기존 브랜치 제거
    try {
      execSync(`git branch -D ${branchName}`, {
        cwd: project.path,
        stdio: "pipe",
      });
    } catch { /* 없으면 무시 */ }

    // worktrees 디렉토리 생성
    const worktreesDir = join(project.path, ".jarvis-worktrees");
    if (!existsSync(worktreesDir)) mkdirSync(worktreesDir, { recursive: true });

    // 새 브랜치 + worktree 생성
    execSync(
      `git worktree add -b ${branchName} "${worktreeDir}" ${project.parent_branch}`,
      { cwd: project.path, stdio: "pipe" },
    );

    session.branch = branchName;
    session.worktree_path = worktreeDir;
    session.state = "working";
    saveWorkflow(userId, session);

    // 3. 이슈 모드면 이슈 생성
    let issueInfo = "";
    if (session.mode === "issue" && project.repo) {
      try {
        const issueOutput = execSync(
          `gh issue create --repo ${project.repo} --title "${session.task}" --body "Jarvis 자동 생성 이슈" --json number`,
          { cwd: worktreeDir, encoding: "utf-8", stdio: "pipe" },
        );
        const parsed = JSON.parse(issueOutput);
        session.issue_number = parsed.number;
        saveWorkflow(userId, session);
        issueInfo = `\n이슈: #${parsed.number}`;
      } catch {
        issueInfo = "\n(이슈 생성 실패 — gh CLI 확인 필요)";
      }
    }

    return {
      response: [
        "개발 환경이 준비되었습니다!",
        "",
        `프로젝트: ${project.name}`,
        `브랜치: ${branchName} (← ${project.parent_branch})`,
        `작업 디렉토리: ${worktreeDir}`,
        issueInfo,
        "",
        `작업을 시작합니다: "${session.task}"`,
      ].join("\n"),
      readyToWork: true,
      workDir: worktreeDir,
      task: session.task,
    };
  } catch (err) {
    clearWorkflow(userId);
    return {
      response: `브랜치 생성 실패: ${(err as Error).message}`,
      readyToWork: false,
    };
  }
}

/** 작업 완료 → PR 생성 */
export function finishWorkflow(userId: string): string {
  const session = getWorkflow(userId);
  if (!session || session.state !== "working" || !session.project || !session.worktree_path) {
    return "진행 중인 작업이 없습니다.";
  }

  const project = session.project;
  const worktreeDir = session.worktree_path;

  try {
    // 변경사항 확인
    const status = execSync("git status --porcelain", {
      cwd: worktreeDir,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();

    if (!status) {
      clearWorkflow(userId);
      return "변경사항이 없습니다. 워크플로우를 종료합니다.";
    }

    // commit & push
    execSync("git add -A", { cwd: worktreeDir, stdio: "pipe" });
    execSync(`git commit -m "${session.task}"`, {
      cwd: worktreeDir,
      stdio: "pipe",
    });
    execSync(`git push -u origin ${session.branch}`, {
      cwd: worktreeDir,
      stdio: "pipe",
    });

    // PR 생성
    let prUrl = "(PR 생성 실패)";
    if (project.repo) {
      try {
        const prOutput = execSync(
          `gh pr create --repo ${project.repo} --base ${project.parent_branch} --title "${session.task}" --body "Jarvis 자동 PR" --json url`,
          { cwd: worktreeDir, encoding: "utf-8", stdio: "pipe" },
        );
        const parsed = JSON.parse(prOutput);
        prUrl = parsed.url;
      } catch {
        prUrl = "(PR 생성 실패 — gh CLI 확인 필요)";
      }
    }

    // worktree 정리
    try {
      execSync(`git worktree remove "${worktreeDir}" --force`, {
        cwd: project.path,
        stdio: "pipe",
      });
    } catch { /* ignore */ }

    clearWorkflow(userId);

    return [
      "작업 완료! PR이 생성되었습니다.",
      "",
      `브랜치: ${session.branch} → ${project.parent_branch}`,
      `PR: ${prUrl}`,
      session.issue_number ? `이슈: #${session.issue_number}` : "",
    ].filter(Boolean).join("\n");
  } catch (err) {
    return `PR 생성 실패: ${(err as Error).message}`;
  }
}

/** 워크플로우 취소 */
export function cancelWorkflow(userId: string): string {
  const session = getWorkflow(userId);
  if (!session) return "진행 중인 워크플로우가 없습니다.";

  // worktree 정리
  if (session.worktree_path && session.project) {
    try {
      execSync(`git worktree remove "${session.worktree_path}" --force`, {
        cwd: session.project.path,
        stdio: "pipe",
      });
    } catch { /* ignore */ }
  }

  clearWorkflow(userId);
  return "워크플로우가 취소되었습니다.";
}

/** 워크플로우 상태 조회 */
export function getWorkflowStatus(userId: string): string {
  const session = getWorkflow(userId);
  if (!session) return "진행 중인 워크플로우가 없습니다.";

  const lines = [
    `상태: ${session.state}`,
    `작업: ${session.task}`,
  ];

  if (session.project) lines.push(`프로젝트: ${session.project.name}`);
  if (session.branch) lines.push(`브랜치: ${session.branch}`);
  if (session.worktree_path) lines.push(`디렉토리: ${session.worktree_path}`);
  if (session.issue_number) lines.push(`이슈: #${session.issue_number}`);

  return lines.join("\n");
}

// --- 유틸 ---

function generateBranchName(prefix: string, task: string): string {
  const slug = task
    .toLowerCase()
    .replace(/[가-힣]+/g, (match) => match) // 한글 유지
    .replace(/[^a-z0-9가-힣\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 40);

  return `${prefix}/${slug}`;
}
