---
name: skill-generator
description: "복잡한 작업 완수 후 자동으로 재사용 가능한 SKILL.md를 생성합니다. Hermes Agent의 자율 스킬 생성 기능을 Claude Code 스킬 형식으로 구현. 새 스킬을 ~/.claude/skills/에 저장하고 메모리 서버에 인덱싱합니다."
---

# Skill Generator — 자율 스킬 생성

## 역할

복잡한 작업을 수행한 후, 해당 작업을 재현 가능한 스킬로 변환하여 저장합니다.
이를 통해 Jarvis는 경험으로부터 학습하고 성장합니다.

## 트리거 조건

다음 조건 중 하나 이상 충족 시 스킬 생성을 제안:
- 도구 호출 10회 이상인 세션
- 파일 변경 5개 이상인 세션
- 30분 이상 소요된 세션
- 사용자가 수동으로 `/skill-generator` 호출

## 스킬 생성 절차

### 1. 세션 분석
현재 세션에서 수행한 작업을 분석:
- 어떤 도구를 사용했는가
- 어떤 파일을 읽고/수정했는가
- 어떤 패턴이 반복되었는가
- 핵심 의사결정은 무엇이었는가

### 2. 스킬 초안 생성
Claude Code 스킬 형식으로 SKILL.md 작성:
```markdown
---
name: {스킬명}
description: "{한 줄 설명}"
---

# {스킬명}

## Overview
{스킬이 해결하는 문제와 적용 시점}

## Steps
{단계별 수행 절차}

## References
{참고할 도구, 명령, 패턴}
```

### 3. 보안 스캔
생성된 스킬에 대해 다음을 검사:
- 하드코딩된 시크릿/토큰이 없는지
- 위험한 명령(rm -rf, DROP TABLE 등)이 없는지
- 외부 URL 참조가 안전한지

### 4. 저장 및 인덱싱
- `~/.claude/skills/{skill-name}/SKILL.md`에 저장
- `jarvis_memory_save`로 절차적 메모리에 인덱싱
- 필요 시 `references/`, `scripts/`, `assets/` 하위 파일 생성

## 사용법
```
/skill-generator          # 현재 세션을 스킬로 변환
/skill-generator list     # 생성된 스킬 목록
/skill-generator edit X   # 기존 스킬 수정
```
