# Jarvis

> Personal AI Agent built on Claude Code — 자기 학습하는 멀티채널 개인화 에이전트

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> 처음 보신다면 **[docs/00-overview.md](docs/00-overview.md)** 를 먼저 읽어보세요.
> 디렉토리 구조, 워크플로우, 설정, MCP, 보안, 명령어를 한 번에 정리한 문서입니다.

## 개요

Jarvis는 [Claude Code](https://claude.ai/claude-code)를 기반으로 구축된 개인화 AI 에이전트입니다.
[Hermes Agent](https://github.com/nousresearch/hermes-agent), [OpenClaw](https://github.com/openclaw/openclaw), [Oh My OpenAgent](https://github.com/code-yeongyu/oh-my-openagent)의 핵심 기능을 통합하여, Claude Code 생태계와 완전히 호환되면서도 고급 기능을 제공합니다.

### 왜 Jarvis인가?

| 기존 에이전트 | 문제점 | Jarvis의 해법 |
|-------------|--------|-------------|
| 독립 하네스 | 서드파티 차단 위험 | Claude Code 네이티브 (구독 기반 안전) |
| 자체 생태계 | 기존 도구와 단절 | GSD, gstack 등 기존 생태계 100% 호환 |
| 단일 사용자 | 팀 협업 불가 | 멀티채널 멀티유저 + Docker 격리 |

## 핵심 기능

```
┌─────────────────────────────────────────────────────────┐
│                        Jarvis                            │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ IntentGate  │  │   Memory    │  │    Skill    │     │
│  │ 의도 분석    │  │ 3계층 메모리 │  │ 자율 생성   │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │  Gateway    │  │  Profiles   │  │   CronJob   │     │
│  │ 멀티채널     │  │ 권한 관리    │  │ 반복 작업   │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │          Directory Isolation                     │    │
│  │     --add-dir + --disallowedTools 로컬 보호      │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

| 기능 | 영감 출처 | 설명 |
|------|----------|------|
| IntentGate | Oh My OpenAgent | 요청의 의도/복잡도를 분석하여 최적 대응 |
| 3계층 메모리 | Hermes Agent | 선언적 + 절차적 + 세션검색 + Dreaming |
| 자율 스킬 생성 | Hermes Agent | 복잡한 작업 후 SKILL.md 자동 생성 |
| 멀티채널 게이트웨이 | OpenClaw | Telegram/Discord/Slack 동시 지원 |
| 프로필 권한 | OpenClaw | 4단계 역할 기반 접근 제어 |
| 크론잡 | OpenClaw | 자연어로 반복 작업 등록 |
| 디렉토리 격리 | — | --add-dir + --disallowedTools로 로컬 보호 |

---

### 1. IntentGate (의도 분석)

사용자의 요청을 **사전 분석**하여 최적의 컨텍스트를 프리로딩합니다.

**9가지 카테고리** 자동 분류:

| 카테고리 | 예시 |
|---------|------|
| `coding` | "로그인 기능 만들어줘" |
| `debugging` | "NullPointerException이 발생해" |
| `refactoring` | "이 코드를 클린하게 정리해줘" |
| `research` | "JPA와 MyBatis 차이가 뭐야?" |
| `review` | "이 PR 코드 리뷰해줘" |
| `question` | "이 함수가 뭐 하는 건지 설명해줘" |
| `design` | "결제 시스템 아키텍처를 설계해줘" |
| `devops` | "Docker 배포 파이프라인 구성해줘" |
| `test` | "이 서비스의 단위 테스트를 작성해줘" |

**3단계 복잡도** 추정:

| 레벨 | 기준 | Jarvis 행동 |
|------|------|------------|
| `quick` | 단일 파일, 간단한 수정 | 즉시 실행 |
| `standard` | 여러 파일, 일반 작업 | 관련 스킬/메모리 프리로딩 |
| `deep` | 복잡한 설계, 멀티스텝 | 작업 계획 수립 + 풀 프리로딩 |

---

### 2. 3계층 메모리 + Dreaming

| 계층 | 저장 내용 | 예시 |
|------|----------|------|
| **선언적** | 사실, 선호도, 기술 스택 | "Kotlin + Spring Boot 사용" |
| **절차적** | 스킬 인덱스 (자동 스캔) | "kotlin-expert, ddd-context-loader" |
| **세션 검색** | 과거 대화 FTS5 전문 검색 | "3일 전 JPA N+1 해결 내역" |
| **Dreaming** | 주기적 정리 | 중복 병합, 오래된 사실 아카이브 |

---

### 3. 자율 스킬 생성

복잡한 작업 완수 후 자동으로 `SKILL.md`를 생성하여 재사용 가능한 지식으로 보존합니다.

**자동 넛지 조건**: 도구 15회+ / 파일 변경 5개+ / 30분+ 경과

**생성 절차**: 세션 분석 → 사용자 확인 → SKILL.md 작성 → 보안 스캔 → 저장 및 인덱싱

**보안 스캔**: API 키 하드코딩, 파괴적 명령(`rm -rf`, `DROP TABLE`), 동적 실행(`eval`) 등 자동 차단

---

### 4. 멀티채널 게이트웨이 + 백그라운드 데몬

**Jarvis Daemon**이 백그라운드에서 상시 대기하며, 채널 메시지를 수신 → `claude` CLI를 자동 호출합니다.

```
Jarvis Daemon (백그라운드, launchd로 자동 시작)
│
├── Telegram/Discord/Slack 봇 (상시 리스닝)
│
├── 메시지 수신 시:
│   1. Gateway 라우팅 (인증/권한 체크)
│   2. 프로필 → 허용 도구 자동 매핑 (승인 불필요)
│   3. claude -p "{요청}" --allowedTools "Read,Grep,..."
│   4. 응답을 해당 채널로 전송
│
└── 별도 터미널 없이 24시간 동작
```

**프로필별 자동 승인**: 외부 채널 요청 시 매번 허락을 받지 않고, 프로필 권한 범위 내에서 `--allowedTools`로 사전 매핑되어 자동 실행됩니다.

**데몬 관리**:
```bash
./jarvis.sh start      # 백그라운드 시작
./jarvis.sh stop       # 종료
./jarvis.sh status     # 상태 확인
./jarvis.sh logs       # 실시간 로그
./jarvis.sh install    # 맥 부팅 시 자동 시작 (launchd)
./jarvis.sh uninstall  # 자동 시작 해제
```

**DM 페어링**: 알 수 없는 발신자가 메시지를 보내면 6자리 페어링 코드를 발급. Owner가 터미널에서 승인해야 사용 가능.

---

### 5. 프로필 기반 권한 관리

| 기능 | owner | developer | reviewer | observer |
|------|-------|-----------|----------|----------|
| 코드 읽기 | 전체 | 프로젝트만 | 프로젝트만 | 프로젝트만 |
| 코드 쓰기 | O | 프로젝트만 | X | X |
| 명령 실행 | 전체 | 테스트/빌드만 | X | X |
| Git | 전체 | add/commit/push | 읽기 전용 | X |
| 크론잡 | O | O | O | O |
| 디렉토리 격리 | X (전체 접근) | O | O | O |
| 타임아웃 | 10분 | 5분 | 2분 | 1분 |

각 프로필 내에서 **개인화** 가능: 에이전트 성격(tone), 언어, 상세도, 이모지, 호칭

#### 프로필 생성

```bash
jarvis create-profile
```

인터랙티브 마법사가 안내에 따라 설정합니다:
1. 프로필 이름/설명
2. 허용 도구 카테고리 선택 (파일 읽기, 쓰기, Git, 빌드 등)
3. 차단 명령 설정 (rm -rf, sudo, ssh 등)
4. 접근 가능 디렉토리 지정 (없으면 자동 생성)
5. 시스템 프롬프트 설정
6. 타임아웃

설정은 `config/profiles.yml`에 저장되며, 코드 수정 없이 YAML만 편집해도 됩니다.

---

### 6. 디렉토리 격리 (로컬 보호)

owner 외 모든 프로필은 **지정된 프로젝트 디렉토리만** 접근 가능합니다.
Docker 없이 Claude CLI의 `--add-dir` + `--disallowedTools`로 보호합니다.

```
팀원 요청 시 실제 실행되는 명령:

claude -p "로그인 기능 구현해줘" \
  --allowedTools "Read,Write,Edit,Grep,..."  ← 허용 도구만
  --disallowedTools "Bash(sudo:*),..."       ← 위험 명령 차단
  --add-dir "/project/vingle-backend"        ← 이 디렉토리만 접근 가능
```

**보호 범위**:

| 보호 대상 | 방법 |
|----------|------|
| `~/.ssh`, `~/.env` | `--add-dir`로 프로젝트만 허용 (나머지 접근 불가) |
| `rm -rf`, `sudo` | `--disallowedTools`로 차단 |
| `git push --force` | `--disallowedTools`로 차단 |
| `cat /etc/passwd` | `--disallowedTools`로 차단 |
| 비용 과다 사용 | 타임아웃으로 제한 |

---

### 7. 개발 워크플로우 (/dev)

`/dev` 커맨드로 체계적인 개발 프로세스를 실행합니다.
일반 질문은 그냥 메시지를 보내면 되고, **코드 작업이 필요할 때만** `/dev`를 사용합니다.

```
멤버: /dev UserService에 이메일 검증 추가

Jarvis: "어떤 프로젝트에서 작업할까요?
         1. vingle-backend
         번호를 입력하세요."

멤버: 1

Jarvis: "어떻게 시작할까요?
         1. 이슈 생성 후 브랜치 생성
         2. 바로 브랜치 생성하여 개발 시작"

멤버: 2

Jarvis: "개발 환경이 준비되었습니다!
         브랜치: feature/userservice에-이메일-검증-추가 (← dev)
         작업을 시작합니다..."
         [코드 작업 수행]

멤버: /dev done

Jarvis: "PR이 생성되었습니다.
         PR: https://github.com/.../pull/42"
```

| 커맨드 | 동작 |
|--------|------|
| `/dev {작업 내용}` | 워크플로우 시작 (프로젝트 선택 → 브랜치 생성) |
| `/dev status` | 현재 진행 상태 확인 |
| `/dev done` | commit → push → PR 생성 |
| `/dev cancel` | 워크플로우 취소 + worktree 정리 |

**동작 원리**:
1. `dev` 브랜치에서 `git pull` (최신화)
2. `feature/{task}` 브랜치 생성 (worktree로 격리)
3. 해당 worktree에서 Claude가 코드 작업
4. `/dev done` 시 commit → push → PR 자동 생성

**프로젝트 설정** (`config/projects.jsonc`):
```jsonc
{
  "projects": {
    "vingle-backend": {
      "name": "vingle-backend",
      "path": "/로컬/경로/vingle-backend",   // 로컬 git clone 경로
      "parent_branch": "dev",                // pull 받을 부모 브랜치
      "repo": "org/vingle-backend",          // GitHub owner/repo (PR 생성용)
      "allowed_profiles": ["owner", "developer"],
      "branch_prefix": "feature"
    }
  }
}
```

---

### 8. 크론잡

**모든 유저**가 한국어 자연어로 반복 작업을 등록할 수 있습니다:

```
/cron add 매일 9시 오늘 할 일 정리해줘
/cron add 평일 10시 스탠드업 요약해줘
/cron add 매주 월요일 9시 주간 리포트 작성해줘
/cron add 30분마다 서버 상태 확인해줘
/cron list
/cron delete {job_id}
```

---

## 사용법

### 터미널 명령 (jarvis CLI)

`setup.sh` 실행 후 어디서든 `jarvis` 명령으로 사용할 수 있습니다.

```bash
# Jarvis와 대화
jarvis chat                # 인터랙티브 대화 모드 시작
jarvis ask "질문 내용"      # 한 번 질문하고 답변 받기
```

```bash
# 백그라운드 데몬 (팀원 채널 리스닝)
jarvis start               # 데몬 시작
jarvis stop                # 데몬 종료
jarvis restart             # 재시작
jarvis status              # 실행 상태
jarvis logs                # 실시간 로그
```

```bash
# 맥 부팅 시 자동 시작
jarvis install             # launchd 등록
jarvis uninstall           # 등록 해제
```

```bash
# 설정 마법사 (인터랙티브)
jarvis create-profile      # 프로필 생성
jarvis edit-profile <name> # 기존 프로필 수정 ([현재값] 표시)
jarvis add-project         # 프로젝트 추가 (디렉토리 자동 생성)
jarvis add-channel         # 채널 추가 + 토큰 입력 + 라이브 검증
jarvis install-mcp         # Claude Code settings.json 자동 패치
```

```bash
# 관리 명령 (비대화형, 한 줄 실행)
jarvis pair list                          # 대기 페어링 목록
jarvis pair approve <code> <profile>      # 페어링 승인
jarvis pair reject <user_id>              # 페어링 거부
jarvis list profiles|users|channels       # 조회
jarvis doctor [--quick]                   # 진단 (11개 항목)
jarvis project ls|add|rm                  # 프로젝트 CRUD
jarvis channel ls|enable|disable|token    # 채널 CRUD
jarvis user ls|show|profile|rename|rm     # 유저 관리
```

> **`jarvis chat`과 `jarvis start`는 별개입니다.**
> - `jarvis chat` — 본인이 터미널에서 직접 Jarvis와 대화. 데몬 없이 단독 사용 가능.
> - `jarvis start` — 팀원이 Telegram/Discord/Slack으로 접근할 수 있도록 백그라운드 리스닝.
> - 혼자만 쓴다면 **`jarvis chat`만으로 충분**합니다.

상세 가이드: [docs/08-owner-cli.md](docs/08-owner-cli.md)

### Claude Code 스킬 커맨드 (대화 중 사용)

| 커맨드 | 기능 |
|--------|------|
| `/jarvis` | 현재 세션의 의도 분석 결과 표시 |
| `/jarvis {요청}` | 의도 분석 후 즉시 작업 (스킬/메모리 프리로딩) |
| `/jarvis stats` | 메모리 통계 |
| `/jarvis dream` | Dreaming 실행 (메모리 정리) |
| `/jarvis skills` | 등록된 스킬 목록 |
| `/jarvis sync` | 스킬 인덱스 + 세션 로그 DB 동기화 |
| `/skill-generator` | 현재 세션을 재사용 가능한 스킬로 변환 |
| `/skill-generator list` | 생성된 스킬 목록 |
| `/skill-generator edit {이름}` | 기존 스킬 수정 |

### 채널 관리 (Owner 전용)

| 커맨드 | 기능 |
|--------|------|
| `/jarvis-telegram pair list` | 대기 중인 페어링 요청 목록 |
| `/jarvis-telegram pair approve {코드} {프로필}` | 페어링 승인 |
| `/jarvis-telegram pair reject {유저ID}` | 페어링 거부 |
| `/jarvis-telegram status` | 채널 상태 조회 |

### 팀원 채널 커맨드 (Telegram/Discord/Slack)

| 커맨드 | 기능 |
|--------|------|
| `/help` | 도움말 |
| `/status` | Jarvis 상태 |
| `/profile` | 내 프로필 조회 |
| `/personality` | 개인화 설정 조회 |
| `/dev {작업 내용}` | 개발 워크플로우 시작 |
| `/dev status` | 개발 진행 상태 |
| `/dev done` | commit → push → PR 생성 |
| `/dev cancel` | 워크플로우 취소 |
| `/cron add {스케줄} {작업}` | 크론잡 등록 |
| `/cron list` | 크론잡 목록 |
| `/cron delete {id}` | 크론잡 삭제 |
| 일반 메시지 | AI 질문으로 처리 (코드 작업 없음) |

### MCP 도구 (19개)

<details>
<summary>메모리 서버 (jarvis-memory) — 11개 도구</summary>

| 도구 | 설명 |
|------|------|
| `jarvis_memory_save` | 메모리 저장 (선언적/절차적) |
| `jarvis_memory_recall` | FTS5 전문 검색 |
| `jarvis_memory_list` | 메모리 목록 조회 |
| `jarvis_session_save` | 세션 기록 (시작/메시지/종료) |
| `jarvis_session_search` | 과거 세션 검색 |
| `jarvis_memory_dream` | Dreaming 실행 |
| `jarvis_dream_history` | Dreaming 실행 히스토리 |
| `jarvis_user_profile` | 프로파일 관리 |
| `jarvis_memory_stats` | 전체 통계 |
| `jarvis_sync_skills` | 스킬 인덱스 DB 동기화 |
| `jarvis_sync_sessions` | 세션 로그 DB 동기화 |

</details>

<details>
<summary>게이트웨이 서버 (jarvis-gateway) — 7개 도구</summary>

| 도구 | 설명 |
|------|------|
| `jarvis_gateway_route` | 채널 메시지 라우팅 (인증/권한/분기) |
| `jarvis_gateway_send` | 특정 채널로 메시지 전송 |
| `jarvis_gateway_pair` | DM 페어링 관리 |
| `jarvis_profile_manage` | 프로필/개인화 관리 |
| `jarvis_cron_manage` | 크론잡 CRUD |
| `jarvis_worktree_manage` | git worktree 관리 |
| `jarvis_gateway_status` | 게이트웨이 상태 |

</details>

---

## 아키텍처

```
Claude Code (구독 기반, 메인 에이전트)
│
├── ~/.claude/skills/
│   ├── jarvis/              ← IntentGate 오케스트레이터
│   ├── skill-generator/     ← 자율 스킬 생성 + 보안 스캔
│   └── jarvis-telegram/     ← Telegram 채널 처리기
│
├── ~/.claude/hooks/
│   ├── auto-memory.js       ← 세션 도구 사용 자동 추적
│   └── skill-nudge.js       ← 복잡 작업 후 스킬 생성 넛지
│
└── MCP Servers (로컬)
     ├── jarvis-memory       ← SQLite + FTS5 메모리 엔진
     └── jarvis-gateway      ← 채널 라우팅 + 인증 + 프로필 + 디렉토리 격리
```

## 빠른 시작

### 요구 사항

- [Claude Code](https://claude.ai/claude-code) 구독
- [Bun](https://bun.sh/) v1.0+

### 설치

```bash
# 1. 클론 및 설치
git clone https://github.com/hyeon0208/jarvis.git ~/jarvis
cd ~/jarvis && chmod +x setup.sh && ./setup.sh

# 2. 환경 변수 설정 (채널 사용 시)
cp .env.example .env
# .env 파일을 편집하여 채널 토큰 입력

# 3. Claude Code에 MCP 서버 등록
# ~/.claude/settings.json에 추가 (상세: docs/GUIDE.md 참고)
```

```jsonc
{
  "mcpServers": {
    "jarvis-memory": {
      "command": "bun",
      "args": ["run", "~/jarvis/packages/memory-server/src/index.ts"]
    },
    "jarvis-gateway": {
      "command": "bun",
      "args": ["run", "~/jarvis/packages/gateway-server/src/index.ts"]
    }
  }
}
```

```bash
# 4. Claude Code 재시작 후 확인
/jarvis stats
```

### 상세 가이드

설치, 설정, 트러블슈팅 등 전체 가이드: **[docs/GUIDE.md](docs/GUIDE.md)**

## 프로젝트 구조

```
jarvis/
├── packages/
│   ├── memory-server/     ← 메모리 MCP 서버 (SQLite + FTS5)
│   ├── gateway-server/    ← 채널 게이트웨이 MCP 서버
│   │   └── src/adapters/  ← Telegram/Discord/Slack 어댑터
│   └── sandbox/           ← Docker 샌드박스 이미지 (선택)
├── skills/                ← Claude Code 스킬
├── hooks/                 ← Claude Code 훅
├── scripts/               ← 프로필 생성 마법사 등
├── config/
│   ├── profiles.yml       ← 프로필별 권한/도구/디렉토리 설정
│   └── projects.jsonc     ← 프로젝트 저장소 등록
├── docs/                  ← 사용 가이드 (7개 문서)
└── package.json           ← Bun 모노레포
```

## 영감을 준 프로젝트

- [Hermes Agent](https://github.com/nousresearch/hermes-agent) — 자기 개선 학습 루프, 3계층 메모리
- [OpenClaw](https://github.com/openclaw/openclaw) — 멀티채널 게이트웨이, 플러그인 아키텍처
- [Oh My OpenAgent](https://github.com/code-yeongyu/oh-my-openagent) — Discipline Agents, IntentGate

## 라이선스

[MIT](LICENSE)
