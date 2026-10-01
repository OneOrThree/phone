#!/bin/zsh
# 원본 음원 → 끊김 없는 루프 WAV (32 kHz · 16-bit · 모노), 음량 통일.
# 사용: scripts/make-audio-loop.sh <원본> <출력.wav> [루프길이초=120] [시작오프셋초=0] [크로스페이드초=4]
# 필요: ffmpeg · ffprobe · python3. 검증용 2회 이어붙인 파일은 실행 위치의 check/ 에 남는다.
# 방식: S[off+X : off+X+L] 뒤에 S[off : off+X]를 등출력(qsin) 크로스페이드로 이어 붙인다.
#       → 파일 끝이 파일 시작 직전 소리로 흘러가므로 loop 재생 때 이음새가 없다.
set -euo pipefail
in=$1; out=$2; L=${3:-120}; off=${4:-0}; X=${5:-4}; target=-23   # LUFS(모노). 배경음이라 음악보다 낮게, 피크 리미터 거의 안 걸리는 선
src_len=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$in")
need=$(python3 -c "print($off+$X+$L)")
if (( $(python3 -c "print(int($src_len < $need))") )); then
  L=$(python3 -c "import math; print(math.floor($src_len-$off-$X))"); echo "원본 짧음 → 루프 길이 ${L}s로 줄임"
fi
tmp=$(mktemp -t loop).wav
ffmpeg -v error -y -i "$in" -filter_complex "
  [0:a]atrim=start=$((off+X)):duration=${L},asetpts=PTS-STARTPTS[body];
  [0:a]atrim=start=${off}:duration=${X},asetpts=PTS-STARTPTS[head];
  [body][head]acrossfade=d=${X}:c1=qsin:c2=qsin[loop]" -map "[loop]" -ac 1 -ar 32000 -c:a pcm_s16le "$tmp"
# 음량 측정 → 목표 LUFS까지 선형 게인, 피크는 -1 dBFS 리미터로만 보호
I=$(ffmpeg -nostats -i "$tmp" -af ebur128 -f null - 2>&1 | grep -E '^\s+I:' | tail -1 | awk '{print $2}')
gain=$(python3 -c "print(round($target-($I),2))")
ffmpeg -v error -y -i "$tmp" -t ${L} -af "volume=${gain}dB,alimiter=limit=0.89:level=false" -ac 1 -ar 32000 -c:a pcm_s16le "$out"
rm -f "$tmp"
# 검증: 앞/뒤 100 ms RMS 차이(이음새 튐), 2회 이어붙인 청취용 파일
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out")
head_rms=$(ffmpeg -nostats -i "$out" -af "atrim=0:0.1,astats=measure_overall=RMS_level:measure_perchannel=none" -f null - 2>&1 | grep 'RMS level' | awk '{print $NF}')
tail_rms=$(ffmpeg -nostats -i "$out" -af "atrim=start=$(python3 -c "print($dur-0.1)"),astats=measure_overall=RMS_level:measure_perchannel=none" -f null - 2>&1 | grep 'RMS level' | awk '{print $NF}')
mkdir -p check; ffmpeg -v error -y -i "$out" -filter_complex "[0:a][0:a]concat=n=2:v=0:a=1" "check/$(basename ${out%.wav})-x2.wav"
printf '%s  길이=%.3fs (%d ms)  원본I=%s LUFS 게인=%sdB  앞RMS=%s 뒤RMS=%s dBFS\n' "$out" "$dur" "$(python3 -c "print(round($dur*1000))")" "$I" "$gain" "$head_rms" "$tail_rms"
