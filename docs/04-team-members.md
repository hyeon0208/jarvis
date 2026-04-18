# 팀원 등록 및 관리

## 개요

팀원은 **Telegram에서 Jarvis 봇에 DM**을 보내 사용합니다.
Owner가 페어링 코드를 승인하고 프로필을 지정하면, 해당 권한 범위 내에서 Jarvis를 사용할 수 있습니다.

## 전체 흐름

```
┌──────────┐     ┌──────────────┐     ┌──────────┐
│ 팀원     │     │ Telegram 봇  │     │ Owner    │
│ (모바일)  │     │ @jv_gw_bot   │     │ (터미널)  │
└────┬─────┘     └──────┬───────┘     └────┬─────┘
     │                  │                  │
     │  1. 봇 검색 후    │                  │
     │     메시지 전송    │                  │
     ├─────────────────>│                  │
     │                  │                  │
     │  2. 페어링 코드   │                  │
     │     발급          │                  │
     │<─────────────────┤                  │
     │                  │                  │
     │  3. 코드를 Owner에게 전달 (카톡 등)   │
     ├──────────────────────────────────-->│
     │                  │                  │
     │                  │  4. 프로필 지정    │
     │                  │     승인          │
     │                  │<─────────────────┤
     │                  │                  │
     │  5. 이후 메시지는 │                  │
     │     바로 처리됨   │                  │
     │<────────────────>│                  │
```

## 1단계: 팀원이 봇에 메시지 전송

팀원이 자기 모바일에서:

1. Telegram 앱 열기
2. 검색창에 `@jv_gw_bot` 검색
3. "시작" 버튼 클릭
4. 아무 메시지 전송 (예: "안녕하세요")

```
팀원 → "안녕하세요"
봇   → "안녕하세요 김철수님! Jarvis를 사용하려면 페어링이 필요합니다.

        페어링 코드: A1B2C3

        관리자에게 이 코드를 전달하세요. 코드는 24시간 후 만료됩니다."
```

## 2단계: Owner가 승인

팀원이 카톡, 슬랙 등으로 코드를 알려주면:

```bash
# 터미널에서
jarvis chat
```

```
# 대화 중
/jarvis-telegram pair list
```

```
# 출력 예시:
대기 중인 페어링:
  코드: A1B2C3
  이름: 김철수
  채널: telegram
  요청 시각: 2026-04-16 10:38
  만료: 2026-04-17 10:38
```

```
# 프로필을 지정하여 승인
/jarvis-telegram pair approve A1B2C3 developer
```

**approve 뒤에 붙이는 단어가 프로필**입니다:

| 승인 명령 | 결과 |
|----------|------|
| `approve A1B2C3 owner` | **Owner 본인 전용** — 전체 권한. 다른 팀원에게 부여 금지 |
| `approve A1B2C3 developer` | 코드 읽기/쓰기, git, 테스트 |
| `approve A1B2C3 reviewer` | 읽기 전용, git 조회 |
| `approve A1B2C3 observer` | 질문/검색만 가능 |

## 3단계: 팀원이 사용

승인 후 팀원이 봇에 메시지를 보내면 바로 처리됩니다:

```
팀원 → "Spring Boot에서 JPA N+1 문제 뭐야?"
봇   → "JPA N+1 문제는 연관 엔티티를 조회할 때 발생하는..."
```

## 프로필 상세

### owner (Owner 본인 전용)

```
허용: 모든 도구, 모든 파일, 모든 명령, git 전체
제한: 없음 (--dangerously-skip-permissions)
용도: Owner 본인의 외부 채널 계정에만 부여
경고: 이 프로필은 jarvis 쉘 명령(Owner CLI)까지 실행 가능.
     팀원에게는 absolutely 부여하지 마세요.
```

### developer (개발자)

```
허용: Read, Write, Edit, Grep, Glob
       git add/commit/push/checkout/branch
       bun test, gradle test, npm test
       /dev 워크플로우
제한: git push --force 차단, git reset --hard 차단
       비용 요청당 $0.5 제한
       새 브랜치 생성 시 반드시 dev/main에서 pull 후 생성
용도: 백엔드/프론트엔드 개발자
```

### reviewer (리뷰어)

```
허용: Read, Grep, Glob
       git status/log/diff/show/blame (읽기 전용)
제한: 파일 수정 불가, 명령 실행 불가
용도: 코드 리뷰어, 시니어 개발자 (검토용)
```

### observer (옵저버)

```
허용: Read, Grep, Glob, WebSearch
제한: docs/ 디렉토리만 접근
       파일 수정 불가, 명령 실행 불가
용도: PM, 디자이너, 신입 (질문용)
```

## 개인화 설정

각 팀원은 프로필 내에서 **에이전트 성격**을 커스터마이징할 수 있습니다:

```
jarvis_profile_manage(
  action: "set_personality",
  user_id: "telegram:12345",
  personality: {
    "tone": "casual",         # formal, casual, friendly, technical
    "language": "ko",         # ko, en, ja
    "verbosity": "concise",   # concise, normal, detailed
    "emoji": true,            # 이모지 사용 여부
    "nickname": "자비스"       # 에이전트 호칭
  }
)
```

## 팀원 관리

### 프로필 변경

```
jarvis_profile_manage(
  action: "set_user_profile",
  user_id: "telegram:12345",
  profile: "reviewer"           # developer → reviewer로 변경
)
```

### 페어링 거부

```
/jarvis-telegram pair reject telegram:12345
```

### 등록된 유저 확인

```
jarvis_profile_manage(action: "list_profiles")
```

## FAQ

### Q: 봇을 프로필마다 따로 만들어야 하나요?

아닙니다. **봇 1개**가 모든 팀원의 요청을 받습니다.
누가 보냈는지는 `chat_id`로 자동 구분되고, 프로필은 유저에 붙습니다.

### Q: 팀원끼리 대화가 보이나요?

아닙니다. 각 팀원은 **자기만의 DM**에서 봇과 1:1로 대화합니다.
다른 팀원의 대화는 볼 수 없습니다.

### Q: 요청 로그는 어떻게 보나요?

```bash
jarvis logs
```

모든 팀원의 요청이 `~/.jarvis/daemon.log`에 기록됩니다.

### Q: 페어링 코드가 만료되면?

24시간 후 자동 만료됩니다. 팀원이 다시 메시지를 보내면 새 코드가 발급됩니다.

## 다음 단계

- [개발 워크플로우](05-dev-workflow.md) — developer 프로필의 `/dev` 커맨드
- [커맨드 레퍼런스](07-commands.md) — 전체 명령 목록
