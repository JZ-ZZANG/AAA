<div align="center">

# AAA
<img src="build/AAA_icon.png" width="200px">

**Asset Administration Assistant**

AI 캐릭터 채팅 사용자를 위한 에셋 관리 도우미 

</div>

---
## 주요기능
- 프로젝트별 작품 관리
- 메인 프롬프트/로어북/시작상황 관리
- 이미지 에셋 리스트 자동 작성 및 분류 보조
- 이미지 에셋 AI 자동 검열 및 수동 검열 도구
- 작업 효율화를 위한 단축키 제공
- 여러 보조 제작도구

---
## 기술 스택

- Electron, Vite
- React, TypeScript, CSS
- Node.js, SQLite(`node:sqlite`)
- Python
 
---
## 개발
```
npm ci  # 의존성 설치
npm run dev  # 개발 모드 실행

python -m pip install -r ai-runtime\requirements.txt  # AI 패키지 의존성 설치

npm test  # 테스트 실행
npm run verify:licenses  # 라이선스 검증

npm run build  # 프론트엔드(React) 빌드
npm run build:ai  # AI 실행 파일 빌드

npm run package:ai  # 빌드된 AI 실행 파일을 ZIP으로 패키징
npm run dist:ai  # AI 실행 파일 빌드 및 ZIP 패키징

npm run dist  # Windows 설치 파일 생성
```

`build:ai`와 `dist:ai`는 AI 의존성이 설치된 파이썬 환경에서 실행합니다.

---
## 라이선스
이 프로젝트는 [GNU Affero General Public License v3.0](LICENSE)에 따라 배포됩니다.

서드파티 구성요소에는 각 구성요소의 라이선스가 별도로 적용되며 원문은 [`licenses`](licenses) 폴더에 보관합니다.

### Ultralytics
AI 패키지는 [Ultralytics](https://github.com/ultralytics/ultralytics)를 사용하며 GNU Affero General Public License v3.0의 적용을 받습니다.

이 저장소는 AI 모델 파일을 포함하지 않습니다. 사용자가 선택한 모델 파일에는 해당 모델 제공자의 라이선스가 별도로 적용됩니다.

### Twemoji
이 프로젝트는 [Twemoji](https://github.com/jdecked/twemoji)를 사용합니다.

- Twemoji 코드: MIT License
- Twemoji 그래픽: Creative Commons Attribution 4.0 International

### Lucide
아이콘은 [Lucide](https://github.com/lucide-icons/lucide)를 사용하며 ISC License의 적용을 받습니다.
