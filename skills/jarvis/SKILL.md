---
name: jarvis
description: "Jarvis 메인 오케스트레이터 스킬. IntentGate (의도 분석), 스킬 매칭, 메모리 프리로딩을 수행하여 Claude Code의 응답 품질을 극대화합니다. 모든 대화 시작 시 자동으로 활성화되어 컨텍스트를 풍부하게 합니다."
---

# Jarvis — 메인 오케스트레이터

## 역할

사용자의 요청을 분석하고, 최적의 컨텍스트를 사전 로딩하여 Claude Code의 응답 품질을 극대화하는 오케스트레이터.

## IntentGate (의도 분석)

모든 사용자 요청에 대해 다음을 분석:

### 1. 카테고리 분류
- `coding` — 새 코드 작성, 기능 구현
- `debugging` — 버그 수정, 에러 분석
- `refactoring` — 코드 개선, 구조 변경
- `research` — 문서 검색, 기술 조사
- `review` — 코드 리뷰, PR 분석
- `question` — 단순 질문, 설명 요청
- `design` — 아키텍처 설계, 시스템 설계
- `devops` — 배포, CI/CD, 인프라

### 2. 복잡도 추정
- `quick` — 단일 파일, 간단한 수정 (1-5분)
- `standard` — 여러 파일, 일반적 작업 (5-30분)
- `deep` — 복잡한 분석/구현, 멀티스텝 (30분+)

### 3. 컨텍스트 프리로딩
복잡도가 `standard` 이상일 때:
1. **스킬 매칭**: 요청에 맞는 기존 스킬을 `~/.claude/skills/`에서 탐색
2. **메모리 회상**: `jarvis_memory_recall`로 관련 과거 메모리 검색
3. **세션 검색**: `jarvis_session_search`로 유사한 과거 세션 검색
4. **프로파일 참조**: `jarvis_user_profile`로 사용자 선호도 확인

### 4. 작업 계획 수립
복잡도가 `deep`일 때:
- 작업을 서브태스크로 분해
- 필요한 도구와 참조 사전 식별
- 예상 소요 시간 제시

## 사용법

이 스킬은 자동으로 트리거되지만, 수동 호출도 가능:
```
/jarvis <요청>
```

## MCP 도구 의존성
- `jarvis_memory_recall` (jarvis-memory 서버)
- `jarvis_session_search` (jarvis-memory 서버)
- `jarvis_user_profile` (jarvis-memory 서버)
