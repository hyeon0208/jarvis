# Jarvis 가이드

> Claude Code 위에서 동작하는 개인화 AI 에이전트

## 문서 목록

| 문서 | 내용 |
|------|------|
| [01. 설치 가이드](01-getting-started.md) | 설치, 설정, 디렉토리 구조 |
| [02. 아키텍처](02-architecture.md) | 전체 구조, 두 가지 모드, 보안 계층 |
| [03. 백그라운드 데몬](03-daemon.md) | 데몬 관리, launchd, 자동 승인, 로그 |
| [04. 팀원 등록/관리](04-team-members.md) | 페어링, 프로필, 개인화, FAQ |
| [05. 개발 워크플로우](05-dev-workflow.md) | /dev 커맨드, git 워크플로우, worktree |
| [06. 메모리 시스템](06-memory.md) | 3계층 메모리, Dreaming, 스킬 생성 |
| [07. 커맨드 레퍼런스](07-commands.md) | 터미널/스킬/채널/MCP 전체 명령 목록 |
| [08. Owner CLI](08-owner-cli.md) | Owner가 로컬 터미널에서 쓰는 관리 명령 (pair/list/doctor/project/channel/user) + 마법사 + 자동 진단 |

## 빠른 시작

```bash
# 설치
git clone https://github.com/hyeon0208/jarvis.git ~/jarvis
cd ~/jarvis && ./setup.sh

# 혼자 쓸 때
jarvis chat

# 팀원이 있을 때
jarvis start
```
