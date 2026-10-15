#!/bin/bash
set -e

echo "🔧 Prettier 자동 수정..."
npm run format:fix

echo ""
echo "🔧 ESLint 자동 수정..."
npm run lint:fix

echo ""
echo "✅ Prettier 검사..."
npm run format:check

echo ""
echo "✅ ESLint 검사..."
npm run lint

echo ""
echo "✨ 완료!"
