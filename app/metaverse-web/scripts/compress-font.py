"""앱의 고운돋움 원본을 글리프 제거 없이 WOFF2로 변환한다.

실행: python3 -m pip install fonttools brotli && python3 scripts/compress-font.py
"""
from pathlib import Path
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parents[1]
font = TTFont(root.parent / 'app-dev/src/assets/fonts/gowun-dodum.ttf')
font.flavor = 'woff2'
font.save(root / 'public/fonts/gowun-dodum.woff2')
