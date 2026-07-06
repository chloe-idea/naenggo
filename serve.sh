#!/bin/bash
# Mac에서 실행 → iPhone Safari/Chrome에서 표시된 주소로 접속
cd "$(dirname "$0")"

PORT="${PORT:-8765}"
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"

if [ -z "$IP" ]; then
  IP="$(ifconfig | awk '/inet 192\.168\.|inet 10\./ {print $2; exit}')"
fi

if [ ! -d "server/node_modules" ]; then
  echo "서버 의존성 설치 중..."
  (cd server && npm install) || exit 1
fi

if [ ! -f ".env" ] && [ -f ".env.example" ]; then
  echo ""
  echo "⚠️  .env 파일이 없습니다. cp .env.example .env 후"
  echo "    OPENAI_API_KEY, FIREBASE_SERVICE_ACCOUNT_* 를 설정해 주세요."
  echo ""
fi

echo ""
echo "============================================"
echo "  냉장GO 개발 서버 (API + 정적)"
echo "============================================"
echo ""
echo "  Mac:     http://localhost:${PORT}"
if [ -n "$IP" ]; then
  echo "  iPhone:  http://${IP}:${PORT}"
else
  echo "  iPhone:  Wi-Fi IP를 찾지 못했습니다."
  echo "           시스템 설정 → Wi-Fi → IP 주소 확인"
fi
echo ""
echo "  API:     POST /api/extract-youtube-recipe"
echo "           POST /api/extract-video-recipe (통합)"
echo ""
echo "  ※ 코드 변경 후에는 Ctrl+C 로 서버를 재시작해야 새 API가 반영됩니다."
echo "  ※ iPhone에서 localhost 는 Mac이 아닌 폰 자신을 가리킵니다."
echo "  ※ Mac과 iPhone이 같은 Wi-Fi에 연결되어 있어야 합니다."
echo "  ※ 방화벽이 막으면: 시스템 설정 → 네트워크 → 방화벽"
echo ""
echo "  종료: Ctrl + C"
echo "============================================"
echo ""

if [ -f ".env" ]; then
  echo ""
  echo "OpenAI API Key 검증 중..."
  if node scripts/verify-openai-key.mjs; then
    echo ""
  else
    echo ""
    echo "⚠️  OPENAI_API_KEY가 OpenAI에서 거부되었습니다."
    echo "    platform.openai.com/api-keys 에서 새 Secret Key를 발급해"
    echo "    .env 의 OPENAI_API_KEY 를 교체한 뒤 서버를 다시 시작하세요."
    echo ""
  fi
fi

export PORT
exec node server/index.js
