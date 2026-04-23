/**
 * Jarvis 명령어 단일 소스.
 *
 * 여기서 선언한 메타데이터를 기반으로:
 *   - `jarvis help` 출력 (scripts/help.ts)
 *   - `docs/07-commands.md` 참조 (수동 동기화 중)
 *   - 채널 봇 메뉴 (daemon.ts의 TELEGRAM_COMMANDS — channelCommand=true 필터)
 *
 * 새 명령을 추가하거나 기존 명령을 바꿀 때 이 파일 한 곳만 수정하면
 * help/docs/채널 메뉴가 동기화됩니다. 디스패치(실제 실행)는 jarvis.sh
 * case문이 담당 — commands.ts는 선언만.
 *
 * 원칙: 최소 중복. `cmd_*` 함수 본문은 jarvis.sh에 남기고 여기에는 이름/설명/카테고리만.
 */

export type CommandCategory =
  | "conversation" // 터미널 대화
  | "daemon" // 데몬 제어
  | "launchd" // 부팅 자동 시작
  | "wizard" // 설정 마법사 (인터랙티브)
  | "admin" // 페어링/프로젝트/채널/유저 관리
  | "cron" // 크론잡
  | "query" // 조회/진단
  | "channel_dev" // 외부 채널 /dev 워크플로우
  | "channel_sys" // 외부 채널 시스템 커맨드 (/help, /clear 등)
  | "channel_cron"; // 외부 채널 /cron

export interface CommandSpec {
  /** 명령 이름 — `jarvis xxx` 또는 `/xxx`의 xxx. */
  name: string;
  /** `jarvis user ls|show|profile|...` 같은 복합 사용법도 기록. */
  usage: string;
  /** 한국어 설명. */
  description: string;
  category: CommandCategory;
  /** 채널 봇 메뉴에 노출할지 (`/command` 류만 true). */
  channelCommand?: boolean;
}

export const BUILTIN_COMMANDS: CommandSpec[] = [
  // ───── 대화 ─────
  {
    name: "chat",
    usage: "jarvis chat",
    description: "Jarvis와 터미널에서 인터랙티브 대화",
    category: "conversation",
  },
  {
    name: "ask",
    usage: 'jarvis ask "질문"',
    description: "한 번 질문하고 답변 받기 (non-interactive)",
    category: "conversation",
  },

  // ───── 데몬 ─────
  { name: "start", usage: "jarvis start", description: "백그라운드 데몬 시작 (채널 리스닝)", category: "daemon" },
  { name: "stop", usage: "jarvis stop", description: "데몬 종료", category: "daemon" },
  { name: "restart", usage: "jarvis restart", description: "데몬 재시작", category: "daemon" },
  { name: "status", usage: "jarvis status", description: "실행 상태 확인", category: "daemon" },
  {
    name: "logs",
    usage: "jarvis logs [N] [--level LV] [--user ID] [--channel CH] [--no-follow]",
    description: "데몬 로그 조회 + 필터링",
    category: "daemon",
  },

  // ───── launchd ─────
  { name: "install", usage: "jarvis install", description: "맥 부팅 자동 시작 등록", category: "launchd" },
  { name: "uninstall", usage: "jarvis uninstall", description: "자동 시작 해제", category: "launchd" },

  // ───── 마법사 ─────
  { name: "create-profile", usage: "jarvis create-profile", description: "프로필 생성 마법사", category: "wizard" },
  {
    name: "edit-profile",
    usage: "jarvis edit-profile <name>",
    description: "기존 프로필 수정 (현재값 표시)",
    category: "wizard",
  },
  { name: "add-project", usage: "jarvis add-project", description: "프로젝트 추가 마법사", category: "wizard" },
  { name: "add-channel", usage: "jarvis add-channel", description: "채널 추가 + 토큰 + 라이브 검증", category: "wizard" },
  {
    name: "install-mcp",
    usage: "jarvis install-mcp [--dry-run]",
    description: "Claude Code settings.json idempotent 패치",
    category: "wizard",
  },

  // ───── 관리 ─────
  { name: "pair", usage: "jarvis pair list|approve <code> [profile]|reject <user_id>", description: "페어링 승인/거부", category: "admin" },
  { name: "project", usage: "jarvis project ls|add|rm", description: "프로젝트 CRUD", category: "admin" },
  { name: "channel", usage: "jarvis channel ls|enable|disable|token <name> [value]", description: "채널 CRUD", category: "admin" },
  { name: "user", usage: "jarvis user ls|show|profile|rename|rm <user_id>", description: "유저 관리 (AUTO 열로 자동 페어링 표시)", category: "admin" },

  // ───── 크론 ─────
  { name: "cron", usage: "jarvis cron list|run|recipients ...", description: "크론잡 조회/수동 실행/수신자 관리", category: "cron" },

  // ───── 조회 ─────
  { name: "list", usage: "jarvis list profiles|users|channels|pending", description: "목록 조회", category: "query" },
  { name: "doctor", usage: "jarvis doctor [--quick] [--silent-ok]", description: "전체 진단", category: "query" },

  // ───── 외부 채널 — 시스템 ─────
  { name: "/help", usage: "/help", description: "도움말", category: "channel_sys", channelCommand: true },
  { name: "/status", usage: "/status", description: "Jarvis 상태", category: "channel_sys", channelCommand: true },
  { name: "/profile", usage: "/profile", description: "내 프로필 조회", category: "channel_sys", channelCommand: true },
  { name: "/personality", usage: "/personality", description: "개인화 설정 조회", category: "channel_sys", channelCommand: true },
  { name: "/clear", usage: "/clear", description: "대화 컨텍스트 초기화 (장기 메모리는 유지)", category: "channel_sys", channelCommand: true },
  { name: "/compact", usage: "/compact", description: "맥락 요약 후 새 세션으로 이어가기", category: "channel_sys", channelCommand: true },

  // ───── 외부 채널 — /dev ─────
  { name: "/dev", usage: "/dev <작업>", description: "개발 워크플로우 시작 (developer 프로필 이상)", category: "channel_dev", channelCommand: true },

  // ───── 외부 채널 — /cron ─────
  { name: "/cron", usage: "/cron add|list|delete|pause|run ...", description: "크론잡 관리 (스케줄 포함)", category: "channel_cron", channelCommand: true },
];

/** 카테고리 한글 라벨. */
export const CATEGORY_LABELS: Record<CommandCategory, string> = {
  conversation: "대화",
  daemon: "데몬",
  launchd: "부팅 자동 시작",
  wizard: "설정 마법사",
  admin: "관리 (비대화형)",
  cron: "크론잡 관리",
  query: "조회/진단",
  channel_dev: "외부 채널 /dev 워크플로우",
  channel_sys: "외부 채널 시스템 커맨드",
  channel_cron: "외부 채널 크론잡",
};

/** 주어진 카테고리 목록에 속하는 명령만 필터. */
export function listCommands(filter?: {
  categories?: CommandCategory[];
  channelOnly?: boolean;
}): CommandSpec[] {
  return BUILTIN_COMMANDS.filter((c) => {
    if (filter?.categories && !filter.categories.includes(c.category)) return false;
    if (filter?.channelOnly && !c.channelCommand) return false;
    return true;
  });
}
