# 설치 가이드

## Jarvis란?

Jarvis는 Claude Code 위에서 동작하는 **개인화 AI 에이전트**입니다.

- 터미널에서 `jarvis chat`으로 대화하거나
- Telegram 봇을 통해 팀원들이 원격으로 요청할 수 있습니다

## 요구 사항

| 항목 | 버전 | 필수 |
|------|------|------|
| [Claude Code](https://claude.ai/claude-code) | 구독 활성 | 필수 |
| [Bun](https://bun.sh/) | 1.0+ | 필수 |
| [Docker](https://www.docker.com/) | 20.10+ | 선택 (팀원 샌드박스) |

## 설치 (5분)

### 1단계: 클론 및 설치

```bash
git clone https://github.com/hyeon0208/jarvis.git ~/jarvis
cd ~/jarvis
chmod +x setup.sh
./setup.sh
```

`setup.sh`가 자동으로 처리하는 것:
- `bun install` (의존성 설치)
- `~/.jarvis/` 디렉토리 생성 (런타임 데이터)
- `~/.claude/skills/jarvis` 등 심볼릭 링크
- 기존 Claude Code 스킬 스캔 및 인덱싱
- `jarvis` 글로벌 명령 등록 (`~/.local/bin/`)

### 2단계: Claude Code에 MCP 서버 등록

`~/.claude/settings.json`에 다음을 추가하세요:

```jsonc
{
  "mcpServers": {
    "jarvis-memory": {
      "command": "bun",
      "args": ["run", "/Users/{사용자명}/jarvis/packages/memory-server/src/index.ts"]
    },
    "jarvis-gateway": {
      "command": "bun",
      "args": ["run", "/Users/{사용자명}/jarvis/packages/gateway-server/src/index.ts"]
    }
  }
}
```

그리고 `permissions.allow` 배열에 Jarvis MCP 도구 권한을 추가합니다:

```jsonc
"permissions": {
  "allow": [
    // ... 기존 권한 ...
    "mcp__jarvis-memory__jarvis_memory_save",
    "mcp__jarvis-memory__jarvis_memory_recall",
    "mcp__jarvis-memory__jarvis_memory_list",
    "mcp__jarvis-memory__jarvis_session_search",
    "mcp__jarvis-memory__jarvis_memory_dream",
    "mcp__jarvis-memory__jarvis_memory_stats",
    "mcp__jarvis-memory__jarvis_sync_skills",
    "mcp__jarvis-memory__jarvis_sync_sessions",
    "mcp__jarvis-gateway__jarvis_gateway_route",
    "mcp__jarvis-gateway__jarvis_gateway_send",
    "mcp__jarvis-gateway__jarvis_gateway_pair",
    "mcp__jarvis-gateway__jarvis_profile_manage",
    "mcp__jarvis-gateway__jarvis_cron_manage",
    "mcp__jarvis-gateway__jarvis_gateway_status"
  ]
}
```

### 3단계: 설치 확인

Claude Code를 재시작한 후:

```
/jarvis stats
```

메모리 통계가 표시되면 설치 성공입니다.

### 4단계 (선택): 외부 채널 연결

본인/팀원이 Telegram/Slack/Discord로 Jarvis에 접근하게 하려면 데몬 운영자가 사용할 **각 플랫폼에서 봇을 1개씩** 발급합니다 (Anthropic 공용 봇은 없으므로 직접 발급). 한 플랫폼 안에서는 그 봇 1개로 본인 + 모든 팀원이 동시 사용 가능 — 메시지는 채널의 user/chat ID 단위로 자동 식별·격리됩니다.

예: Telegram만 쓰면 Telegram 봇 1개. Telegram + Slack을 같이 쓰면 Telegram 봇 1개 + Slack App 1개 (총 2개), 데몬 1개가 둘 다 동시 처리.

채널별 설정 가이드:

- **[Telegram](11-telegram-setup.md)** — BotFather에서 봇 생성 + 토큰 등록 + 페어링
- **[Slack](10-slack-setup.md)** — Slack App 생성 + Socket Mode + Bot/App Token
- **Discord** — discord.com/developers/applications에서 봇 생성 → `jarvis channel token discord <토큰>` + `jarvis channel enable discord`

빠른 요약 (Telegram):

```bash
# 1. BotFather에서 봇 생성 → 토큰 받기
# 2. 토큰 등록 + 채널 활성화
jarvis channel token telegram <토큰>
jarvis channel enable telegram
# 3. 데몬 시작
jarvis start
# 4. 본인 페어링
#    Telegram에서 본인이 만든 봇과 대화 → 페어링 코드 발급 →
jarvis pair list
jarvis pair approve <코드> owner
```

상세는 [11. Telegram 채널 설정](11-telegram-setup.md) 참고.

## 디렉토리 구조

Jarvis는 **두 개의 디렉토리**를 사용합니다:

```
~/jarvis/                    ← 소스 코드 (GitHub 저장소, 공유 가능)
├── packages/                   MCP 서버 소스
├── skills/                     Claude Code 스킬
├── hooks/                      자동화 훅
├── config/                     설정 템플릿
├── jarvis.sh                   CLI 도구
└── setup.sh                    설치 스크립트

~/.jarvis/                   ← 런타임 데이터 (자동 생성, 개인 정보)
├── data/memory.db              메모리 DB
├── sessions/                   세션 로그
├── users/                      유저 설정
├── daemon.pid                  데몬 PID
└── daemon.log                  데몬 로그
```

## 설치 후 다음 단계 — 시나리오별 체크리스트

설치가 끝났다면 어떻게 쓸지 먼저 정해보세요. 아래 시나리오 중 해당하는 흐름만 따라가면 됩니다.

### 시나리오 A — 혼자 터미널에서 사용

본인만 터미널에서 `jarvis chat`으로 쓰는 경우. 외부 채널/봇 토큰 전부 불필요.

- [ ] `/jarvis stats` 로 MCP 연결 확인
- [ ] `jarvis chat` 으로 대화 시작
- [ ] 관심 있는 주제에 대해 Jarvis에게 메모해 달라고 요청 (장기 메모리 적재)
- [ ] 필요 시 `jarvis doctor --quick` 로 설정 점검

### 시나리오 B — Telegram 1:1 + 팀원 1-2명

본인 또는 소수 팀원이 외부에서 Telegram DM으로 Jarvis에 접근.

- [ ] BotFather에서 봇 생성 → 토큰 발급 ([11-telegram-setup.md](11-telegram-setup.md))
- [ ] `jarvis channel token telegram <토큰>`
- [ ] `jarvis channel enable telegram`
- [ ] `jarvis start` 후 `jarvis logs` 에서 "Telegram 리스너 활성화됨" 확인
- [ ] 본인 Telegram에서 봇과 대화 시작 → 페어링 코드 → `jarvis pair approve <코드> owner`
- [ ] 팀원이 있다면 봇 username 공유 → 각자 페어링 → `jarvis pair approve <코드> developer|reviewer|observer`
- [ ] 부팅 자동 시작: `jarvis install` (launchd 등록)

### 시나리오 C — Slack 워크스페이스 (자동 페어링)

슬랙 워크스페이스 멤버 전원이 공용 채널에서 `@Jarvis` 멘션으로 쓰게 하는 경우.

- [ ] Slack App 생성 + Socket Mode + `users:read` 등 Scope 추가 ([10-slack-setup.md](10-slack-setup.md))
- [ ] `xoxb-`, `xapp-` 두 토큰 발급 → `jarvis channel token slack <xoxb>` + `.env`에 `SLACK_APP_TOKEN` 추가
- [ ] `jarvis channel enable slack`
- [ ] `jarvis restart` 후 `jarvis logs 30` 에서 "Slack 리스너 활성화됨" 확인
- [ ] 공용 채널에 봇 초대: `/invite @Jarvis`
- [ ] 본인이 먼저 `@Jarvis 안녕` 호출 → 자동 페어링 + macho 응답 → 필요 시 `jarvis user profile slack:U... owner` 로 본인만 승격
- [ ] `jarvis user ls` 로 등록된 멤버 확인 (AUTO 열이 `✓`면 자동 페어링)

### 데몬으로 cron(자동 브리핑 등)을 운영할 때

데몬을 24시간 띄우고 모닝 브리핑 같은 cron job을 돌릴 계획이라면, **Claude 구독 OAuth 토큰이 약 24시간 만료**되어 cron이 매일 같은 시각부터 `Not logged in` 으로 떨어지는 문제를 만나게 됩니다. `claude setup-token`으로 long-lived token을 발급해 `~/jarvis/.env`에 주입하면 구독은 그대로 유지되며 만료 없이 동작합니다.

→ 단계별 가이드: [03-daemon.md — Claude 구독 토큰 매일 만료](03-daemon.md#claude-구독-토큰-매일-만료-cron이-매일-새벽-실패)

### 공통 정리

시나리오가 무엇이든, 이 문서들은 한 번씩 훑어두면 좋습니다:

- [아키텍처 이해](02-architecture.md) — 격리 6층 / MCP 서버 / 데몬 구조
- [팀원 등록](04-team-members.md) — 프로필 비교 + 페어링 흐름
- [메모리 시스템](06-memory.md) — 3계층 메모리 + Dreaming
- [커맨드 레퍼런스](07-commands.md) — 전체 `jarvis` 명령 목록
- [개발 워크플로우](05-dev-workflow.md) — `/dev` 커맨드로 코드 작업
