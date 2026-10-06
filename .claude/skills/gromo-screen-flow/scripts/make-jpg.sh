#!/bin/bash
# shots/final/*.png → shots/jpg/*.jpg (피그마에 올릴 가벼운 그림). 품질은 첫 인자(기본 80)
cd "${WF_DIR:-$HOME/soma/capture-catus}/shots" && mkdir -p jpg
Q=${1:-80}
for f in final/*.png; do
  o="jpg/$(basename "${f%.png}").jpg"
  if [ ! -f "$o" ] || [ "$f" -nt "$o" ] || [ -n "$FORCE" ]; then sips -s format jpeg -s formatOptions "$Q" "$f" --out "$o" >/dev/null; fi
done
ls jpg | wc -l; du -sh jpg | cut -f1
