# Jarvis

> Personal AI Agent built on Claude Code — 자기 학습하는 멀티채널 개인화 에이전트

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Jarvis는 [Claude Code](https://claude.ai/claude-code) 위에 얹는 개인 AI 에이전트입니다.
[Hermes Agent](https://github.com/nousresearch/hermes-agent) · [OpenClaw](https://github.com/openclaw/openclaw) · [Oh My OpenAgent](https://github.com/code-yeongyu/oh-my-openagent)의 핵심 기능을 모아서, **로컬 터미널 대화**와 **Telegram/Discord/Slack 팀원 협업**을 동시에 지원합니다.

> 🔰 처음이라면 **[docs/00-overview.md](docs/00-overview.md)** — 디렉토리/워크플로우/설정/MCP/보안/명령어를 한 문서에 정리했습니다.

---

## 빠른 시작

### 1. 사전 준비

- [Claude Code](https://claude.ai/claude-code) 구독 및 CLI 설치
- [Bun](https://bun.sh/) 1.0+

### 2. 설치 (한 줄)

```bash
git clone https://github.com/hyeon0208/jarvis.git ~/jarvis
cd ~/jarvis && ./setup.sh
```

**`setup.sh`가 자동으로 처리**:

| # | 작업 |
|---|------|
| 1 | `bun install` (의존성 설치) |
| 2 | `~/.jarvis/` 런타임 디렉토리 생성 |
| 3 | `~/jarvis/skills/*` → `~/.claude/skills/` 심볼릭 링크 |
| 4 | 기존 Claude Code 스킬 스캔 및 인덱싱 |
| 5 | `~/.local/bin/jarvis` 글로벌 명령 등록 |
| 6 | `~/.claude/settings.json`에 MCP 서버 2개 + 권한 19개 + 훅 2개 idempotent 패치 (백업 자동 생성) |

설치 후 **Claude Code를 재시작**해야 MCP 서버가 로드됩니다.

### 3. 검증

```bash
jarvis doctor --quick       # 11개 체크, 모두 OK여야 함
```

### 4. 사용 시작

`jarvis chat`과 `jarvis start`는 **역할이 다른 독립 명령**입니다. 하나만 써도 되고, 둘 다 켜도 됩니다.

```bash
# (A) 터미널에서 직접 대화 — 포그라운드, 봇 토큰 불필요
jarvis chat                 # 인터랙티브
jarvis ask "질문 내용"       # 한 번 질문
```

```bash
# (B) 외부 채널(Telegram 등) 요청을 상시 받기 — 백그라운드 데몬 (선택)
jarvis add-channel          # 채널 + 봇 토큰 설정 (최초 1회)
jarvis start                # 데몬 기동
jarvis install              # 맥 부팅 시 자동 시작 (launchd)
```

(A)와 (B)는 서로 간섭하지 않으며 **병행 사용 가능**합니다. Owner 본인은 터미널에서 `chat`을 쓰고, 동시에 데몬이 팀원 Telegram 요청을 받아 처리하는 식으로 조합합니다.

### 5. 새 프로젝트/프로필 추가

```bash
jarvis add-project          # git 저장소 등록 + worktree용 설정
jarvis create-profile       # 새 권한 프로필 생성 (팀원용)
jarvis edit-profile <name>  # 기존 프로필 수정
```

명령어 전체: [docs/07-commands.md](docs/07-commands.md)

---

## 핵심 기능

| 기능 | 요약 | 상세 |
|------|------|------|
| **IntentGate** | 9 카테고리 × 3 복잡도 분류 후 스킬/메모리 프리로딩 | [docs/06-memory.md](docs/06-memory.md) |
| **3계층 메모리 + Dreaming** | 선언적/절차적/세션 FTS5 검색 + 비동기 정리 | [docs/06-memory.md](docs/06-memory.md) |
| **자율 스킬 생성** | 복잡 작업 후 SKILL.md 자동 생성 + 보안 스캔 | [docs/06-memory.md](docs/06-memory.md) |
| **멀티채널 게이트웨이** | Telegram/Discord/Slack 어댑터 + 채널별 활성화 | [docs/04-team-members.md](docs/04-team-members.md) |
| **프로필 권한** | YAML 설정, `--allowedTools`/`--disallowedTools`/`--add-dir`로 격리 | [docs/04-team-members.md](docs/04-team-members.md) |
| **개발 워크플로우** | `/dev` 커맨드 → 프로젝트 선택 → worktree → PR 자동 생성 | [docs/05-dev-workflow.md](docs/05-dev-workflow.md) |
| **크론잡** | 자연어 스케줄 (`"매일 9시 보고서"`) | [docs/07-commands.md](docs/07-commands.md) |
| **Owner CLI** | pair/list/doctor/project/channel/user 관리 명령 + 마법사 | [docs/08-owner-cli.md](docs/08-owner-cli.md) |
| **데몬 자동 진단** | 잘못된 설정이면 데몬 시작 거부 (exit 2) | [docs/03-daemon.md](docs/03-daemon.md) |

---

## 아키텍처 한눈에

```
Claude Code (구독 기반)
│
├── ~/.claude/skills/       스킬
├── ~/.claude/hooks/        훅 (auto-memory, skill-nudge)
└── MCP Servers (자식 프로세스)
     ├── jarvis-memory       SQLite FTS5 메모리
     └── jarvis-gateway      채널 라우팅 + 프로필 + 페어링

별도 백그라운드:
└── Jarvis Daemon (jarvis start)
     └── Telegram/Discord/Slack 리스닝 → claude -p 스폰
```

상세: [docs/02-architecture.md](docs/02-architecture.md)

---

## 프로필 구조

**`owner` 프로필 1개만 고정**입니다. 나머지는 저장소에 예시로 포함된 샘플이며, **본인 팀 구성에 맞게 수정**하는 것이 전제입니다.

| 프로필 | 설명 |
|--------|------|
| **owner** (고정) | Owner 본인의 외부 채널 계정 전용. `skip_permissions: true`. 다른 팀원에게 부여 금지 |
| `developer` (예시) | 코드 읽기/쓰기 + git + 빌드/테스트 (예시이며 커스터마이징 권장) |
| `reviewer` (예시) | 읽기 + git 조회만 (예시) |
| `observer` (예시) | 읽기/검색만 (예시) |

커스터마이징 방법: `jarvis edit-profile <name>` 또는 `jarvis create-profile` — 자세히는 [docs/04-team-members.md](docs/04-team-members.md)

> **owner CLI (로컬 터미널)** 와 **owner 프로필 (외부 채널)** 은 별개 개념입니다.
> 구분: [docs/08-owner-cli.md](docs/08-owner-cli.md#역할-비교)

---

## 디렉토리 구조

```
~/jarvis/                    ← 소스 코드 (GitHub 저장소)
├── packages/                   MCP 서버 소스
├── skills/                     Claude Code 스킬
├── hooks/                      훅 스크립트
├── scripts/                    CLI 엔트리 + 마법사
├── config/                     설정 파일 (YAML/JSONC)
├── docs/                       가이드 문서
└── jarvis.sh                   메인 디스패처

~/.jarvis/                   ← 런타임 데이터 (자동 생성, gitignore)
├── data/memory.db              SQLite + FTS5
├── users/*.json                유저별 설정
├── workflows/                  /dev 상태
└── daemon.log                  데몬 로그
```

두 디렉토리가 왜 분리되었는지: [docs/00-overview.md#1-두-개의-jarvis-디렉토리](docs/00-overview.md#1-두-개의-jarvis-디렉토리)

---

## 문서

전체 가이드: **[docs/GUIDE.md](docs/GUIDE.md)**

| 문서 | 내용 |
|------|------|
| [00. 전체 개요](docs/00-overview.md) | 디렉토리/워크플로우/설정/MCP/보안/명령어 종합 |
| [01. 설치 가이드](docs/01-getting-started.md) | 설치 상세 |
| [02. 아키텍처](docs/02-architecture.md) | 전체 구조, 두 모드, 보안 계층 |
| [03. 백그라운드 데몬](docs/03-daemon.md) | 데몬 관리, launchd, 자동 진단 |
| [04. 팀원 등록/관리](docs/04-team-members.md) | 페어링, 프로필, 개인화 |
| [05. 개발 워크플로우](docs/05-dev-workflow.md) | `/dev` 커맨드, worktree |
| [06. 메모리 시스템](docs/06-memory.md) | 3계층 메모리, Dreaming |
| [07. 커맨드 레퍼런스](docs/07-commands.md) | 전체 명령어 |
| [08. Owner CLI](docs/08-owner-cli.md) | 관리 명령 + 마법사 + 자동 진단 |
| [09. 유저별 Personality](docs/09-personalization.md) | 에이전트 말투/언어/상세도/호칭 커스터마이징 |
| [10. Slack 채널 설정](docs/10-slack-setup.md) | Slack App 생성/Socket Mode/토큰 등록 단계별 가이드 |

---

## 영감을 준 프로젝트

- [Hermes Agent](https://github.com/nousresearch/hermes-agent) — 자기 개선 학습 루프, 3계층 메모리
- [OpenClaw](https://github.com/openclaw/openclaw) — 멀티채널 게이트웨이, 플러그인 아키텍처
- [Oh My OpenAgent](https://github.com/code-yeongyu/oh-my-openagent) — IntentGate, 카테고리 라우팅

## 라이선스

[MIT](LICENSE)
