# 개발 워크플로우 (/dev)

## 개요

`/dev` 커맨드는 체계적인 개발 프로세스를 실행합니다.
일반 질문은 그냥 메시지를 보내면 되고, **코드 작업이 필요할 때만** `/dev`를 사용합니다.

```
일반 질문:  "JPA N+1이 뭐야?"        → 답변만 (코드 변경 없음)
개발 작업:  /dev N+1 문제 해결해줘    → 브랜치 생성 → 코드 수정 → PR
```

## 전체 흐름

```
/dev {작업 내용}
    │
    ├── 1. 프로젝트 선택 (1개면 자동 선택)
    │
    ├── 2. 모드 선택
    │   ├── 1) 이슈 생성 후 브랜치 생성
    │   └── 2) 바로 브랜치 생성
    │
    ├── 3. 환경 준비
    │   ├── git fetch origin
    │   ├── git pull origin dev (부모 브랜치)
    │   └── git worktree add -b feature/{task} (격리된 디렉토리)
    │
    ├── 4. Claude가 코드 작업 수행
    │   └── (추가 요청도 같은 worktree에서 처리)
    │
    └── 5. /dev done
        ├── git add + commit
        ├── git push
        ├── gh pr create
        └── PR 링크 응답
```

## 실제 대화 예시

### 예시 1: 바로 브랜치 생성

```
팀원: /dev UserService에 이메일 검증 추가

Jarvis: 어떤 프로젝트에서 작업할까요?
        1. vingle-backend (vingle-backend)
        번호를 입력하세요.

팀원: 1

Jarvis: 어떻게 시작할까요?
        1. 이슈 생성 후 브랜치 생성
        2. 바로 브랜치 생성하여 개발 시작
        번호를 입력하세요.

팀원: 2

Jarvis: 개발 환경이 준비되었습니다!

        프로젝트: vingle-backend
        브랜치: feature/userservice에-이메일-검증-추가 (← dev)
        작업 디렉토리: /project/.jarvis-worktrees/telegram_12345

        작업을 시작합니다: "UserService에 이메일 검증 추가"

        ---

        UserService에 이메일 검증 로직을 추가했습니다.
        - EmailValidator 클래스 생성
        - UserService.register()에 검증 단계 추가
        - 테스트 작성 완료

팀원: 테스트도 실행해줘

Jarvis: bun test 결과:
        12 pass, 0 fail
        모든 테스트 통과!

팀원: /dev done

Jarvis: 작업 완료! PR이 생성되었습니다.

        브랜치: feature/userservice에-이메일-검증-추가 → dev
        PR: https://github.com/cosmos-official/vingle-backend/pull/42
```

### 예시 2: 이슈 생성 후 브랜치

```
팀원: /dev 결제 실패 시 재시도 로직 구현

Jarvis: 어떤 프로젝트에서 작업할까요?
        1. vingle-backend
        번호를 입력하세요.

팀원: 1

Jarvis: 어떻게 시작할까요?
        1. 이슈 생성 후 브랜치 생성
        2. 바로 브랜치 생성하여 개발 시작

팀원: 1

Jarvis: 개발 환경이 준비되었습니다!

        프로젝트: vingle-backend
        브랜치: feature/결제-실패-시-재시도-로직-구현 (← dev)
        이슈: #15

        작업을 시작합니다...
```

## 커맨드

| 커맨드 | 동작 | 예시 |
|--------|------|------|
| `/dev {작업}` | 워크플로우 시작 | `/dev 로그인 기능 구현` |
| `/dev status` | 진행 상태 확인 | |
| `/dev done` | commit → push → PR 생성 | |
| `/dev cancel` | 워크플로우 취소 + 정리 | |
| `/dev` | 도움말 | |

## 워크플로우 중 추가 요청

`/dev done` 전까지는 **같은 worktree에서 계속 작업**합니다:

```
팀원: /dev 로그인 기능 구현
Jarvis: [브랜치 생성 + 코드 작업]

팀원: 에러 핸들링도 추가해줘        ← 같은 worktree
Jarvis: [추가 작업]

팀원: 테스트 작성해줘               ← 같은 worktree  
Jarvis: [테스트 추가]

팀원: /dev done                    ← 모든 변경사항을 한 PR로
Jarvis: PR 생성 완료!
```

## Git 규칙

| 규칙 | 설명 |
|------|------|
| 부모 브랜치에서 pull | 브랜치 생성 전 `git pull origin dev` 실행 |
| worktree 격리 | 각 작업은 `.jarvis-worktrees/` 아래 독립 디렉토리 |
| force-push 차단 | `git push --force` 사용 불가 |
| reset --hard 차단 | `git reset --hard` 사용 불가 |

## 동시 작업

여러 팀원이 동시에 `/dev`를 실행해도 **각자의 worktree에서 격리 작업**합니다:

```
팀원 A: /dev 로그인 구현
  → .jarvis-worktrees/telegram_111/  (feature/로그인-구현)

팀원 B: /dev 결제 구현
  → .jarvis-worktrees/telegram_222/  (feature/결제-구현)

Owner: main 브랜치에서 직접 작업
  → 프로젝트 루트 디렉토리

→ 브랜치 충돌 없음!
```

## 프로젝트 설정

`~/jarvis/config/projects.jsonc`에서 관리합니다:

```jsonc
{
  "projects": {
    "vingle-backend": {
      "name": "vingle-backend",
      "path": "/Users/hyeonjun/Desktop/프로젝트/vingle-backend",
      "parent_branch": "dev",
      "repo": "cosmos-official/vingle-backend",
      "allowed_profiles": ["owner", "developer"],
      "branch_prefix": "feature"
    }
  }
}
```

| 필드 | 설명 | 예시 |
|------|------|------|
| `path` | 로컬 git clone 경로 | `/Users/.../vingle-backend` |
| `parent_branch` | pull 받을 브랜치 | `dev` 또는 `main` |
| `repo` | GitHub owner/repo (PR 생성용) | `cosmos-official/vingle-backend` |
| `allowed_profiles` | 접근 가능한 프로필 | `["owner", "developer"]` |
| `branch_prefix` | 생성할 브랜치 접두사 | `feature`, `fix`, `hotfix` |

### 프로젝트 추가

```jsonc
{
  "projects": {
    "vingle-backend": { ... },
    "vingle-frontend": {
      "name": "vingle-frontend",
      "path": "/Users/hyeonjun/Desktop/프로젝트/vingle-frontend",
      "parent_branch": "main",
      "repo": "cosmos-official/vingle-frontend",
      "allowed_profiles": ["owner", "developer"],
      "branch_prefix": "feature"
    }
  }
}
```

프로젝트가 여러 개면 `/dev` 실행 시 선택 목록이 표시됩니다.

## 필요한 프로필

`/dev` 커맨드는 **write 권한이 필요**합니다. `owner`와 `developer` 프로필만 사용 가능합니다.

```
owner     → /dev 사용 가능 ✓
developer → /dev 사용 가능 ✓
reviewer  → /dev 사용 불가 ✗ ("write 권한이 필요합니다")
observer  → /dev 사용 불가 ✗
```

## 다음 단계

- [메모리 시스템](06-memory.md) — IntentGate와 메모리 프리로딩
- [커맨드 레퍼런스](07-commands.md) — 전체 명령 목록
