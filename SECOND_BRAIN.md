# 프로젝트 지식 지도

- 요구와 진행 상태: [운영 현황](docs/OPERATING_STATUS.md)
- 제품 북극성과 전체 구조: [교육과정 평가 마스터 설계](docs/CURRICULUM_ASSESSMENT_MASTER.md)
- 단계별 개발·검증 계획: [종합 평가 플랫폼 구현 로드맵](docs/IMPLEMENTATION_ROADMAP.md)
- 실행 안내: [README](README.md)
- 개발 에이전트 규칙: [AGENTS](AGENTS.md)
- 성취기준 출처와 추출 검증: [보고서](data/achievement-standards.2022.md)
- 구조화된 초등 성취기준: [데이터](data/achievement-standards.2022.json)

## 유지할 결정

초등만 다룬다. 교육과정·차시 수업안에서 성취기준을 해석한 뒤 루브릭과 편집 가능한 평가지 초안을 만드는 과정이 응답 방법보다 먼저다. 학생에게 QR로 열리는 화면은 시험지여야 한다. AI 모델은 Luna를 사용하되 실제 비용·접근 가능 여부를 검증한다. 교사가 결과를 최종 판단하며 상중하 환산 기준은 교사 설정임을 명시한다. 학생 성장 요약은 S-W-A-T(강점·보완점·실행학습·다음 목표)로 정리한다. 운영 저장과 데모는 섞지 않는다.

## 운영 연결이 확인된 것

Neon 마이그레이션 0001~0006, Clerk 가입 계정 1명의 교사 승인, Vercel Production·Preview·Development 필수 환경, 학급·명렬·학급별 QR 배포 SQL, 통합 테스트 33개와 Next.js 운영 빌드.

## 아직 증명하지 못한 것

로그인된 교사 브라우저에서 학급 생성부터 별도 학생 기기의 제출·공개 결과 재조회까지의 수동 E2E, OCR/전사/대화 평가, AI 채점 품질, 모바일 실기기 접근성, 개인정보 보존·삭제·백업 운영 절차.
