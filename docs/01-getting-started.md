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

본인 또는 팀원이 Telegram/Slack/Discord 등으로 Jarvis에 접근하게 하려면 **본인 명의의 봇을 직접 생성**해야 합니다 (공용 봇은 제공되지 않습니다 — 데몬 운영자별로 봇이 분리되어 메시지가 본인 머신에서만 처리됩니다).

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

## 다음 단계

- [아키텍처 이해](02-architecture.md) — 전체 구조 파악
- [Telegram 채널 설정](11-telegram-setup.md) — BotFather 단계별 가이드
- [Slack 채널 설정](10-slack-setup.md) — Socket Mode 기반
- [팀원 등록](04-team-members.md) — 페어링 + 프로필 + 개인화
- [개발 워크플로우](05-dev-workflow.md) — `/dev` 커맨드로 코드 작업
