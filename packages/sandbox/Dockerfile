FROM node:22-slim

LABEL maintainer="hyeon0208"
LABEL description="Jarvis sandboxed execution environment for team members"

# 보안: 비특권 사용자 생성
RUN useradd -m -s /bin/bash jarvis-user

# 기본 도구 설치 (최소한만)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Bun 설치
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# 작업 디렉토리
WORKDIR /workspace

# 비특권 사용자로 전환
USER jarvis-user

# 타임아웃 강제 (기본 5분, 런타임에 오버라이드 가능)
ENTRYPOINT ["timeout"]
CMD ["300", "sleep", "infinity"]
