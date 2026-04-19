# Jarvis 가이드

> Claude Code 위에서 동작하는 개인화 AI 에이전트

## 문서 목록

| 문서 | 내용 |
|------|------|
| [**00. 전체 개요**](00-overview.md) | **처음 읽으세요 — 디렉토리/워크플로우/설정/MCP/보안/명령어 종합** |
| [01. 설치 가이드](01-getting-started.md) | 설치, 설정, 디렉토리 구조 |
| [02. 아키텍처](02-architecture.md) | 전체 구조, 두 가지 모드, 보안 계층 |
| [03. 백그라운드 데몬](03-daemon.md) | 데몬 관리, launchd, 자동 승인, 로그 |
| [04. 팀원 등록/관리](04-team-members.md) | 페어링, 프로필, 개인화, FAQ |
| [05. 개발 워크플로우](05-dev-workflow.md) | /dev 커맨드, git 워크플로우, worktree |
| [06. 메모리 시스템](06-memory.md) | 3계층 메모리, Dreaming, 스킬 생성 |
| [07. 커맨드 레퍼런스](07-commands.md) | 터미널/스킬/채널/MCP 전체 명령 목록 |
| [08. Owner CLI](08-owner-cli.md) | Owner가 로컬 터미널에서 쓰는 관리 명령 (pair/list/doctor/project/channel/user) + 마법사 + 자동 진단 |
| [09. 유저별 Personality](09-personalization.md) | 에이전트 말투/언어/상세도/호칭 설정 + 시스템 프롬프트 변환 흐름 |
| [10. Slack 채널 설정](10-slack-setup.md) | Slack App 생성 → Socket Mode → 토큰 등록 → 페어링까지 |
| [11. Telegram 채널 설정](11-telegram-setup.md) | BotFather → 토큰 등록 → 본인/팀원 페어링까지 |

## 빠른 시작

```bash
# 설치
git clone https://github.com/hyeon0208/jarvis.git ~/jarvis
cd ~/jarvis && ./setup.sh
```

`jarvis chat`과 `jarvis start`는 **역할이 다른 독립 명령**이며, 필요에 따라 **둘 다 켤 수 있습니다**.

```bash
# 터미널에서 Jarvis와 직접 대화 (포그라운드)
jarvis chat
```

```bash
# 외부 채널(Telegram/Discord/Slack) 요청을 상시 받기 위한 백그라운드 데몬 (선택)
jarvis add-channel      # 채널 + 봇 토큰 설정 (최초 1회)
jarvis start            # 데몬 시작
jarvis install          # 맥 부팅 시 자동 시작 (launchd, 선택)
```

두 명령의 관계는 [00. 전체 개요 §2 워크플로우](00-overview.md#2-전체-워크플로우)를 참고하세요.
