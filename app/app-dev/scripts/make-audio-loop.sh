#!/usr/bin/env bash
# 원본 음원 → 끊김 없는 루프 WAV (32 kHz · 16-bit · 모노), 음량 통일.
# 사용: scripts/make-audio-loop.sh <원본> <출력.wav> [루프길이초=120] [시작오프셋초=0] [크로스페이드초=4]
# 필요: ffmpeg · ffprobe · python3. 오프셋·길이·크로스페이드는 정수 초.
# 방식: S[off+X : off+X+L] 뒤에 S[off : off+X]를 등출력(qsin) 크로스페이드로 이어 붙인다.
#       → 파일 끝이 파일 시작 직전 소리로 흘러가므로 loop 재생 때 이음새가 없다.
# 게인·리미터는 자르기 전 원본 전체에 먼저 건다. 리미터의 look-ahead 지연(약 5 ms)이
# 잘라낸 구간 안에서 균일하게 밀릴 뿐이라, 파일 앞머리에 무음이 생기지 않는다.
set -euo pipefail
in=$1; out=$2; L=${3:-120}; off=${4:-0}; X=${5:-4}; target=-26   # LUFS(모노). 양쪽 채널로 재생되면 스테레오 환산 약 -23 LUFS
src_len=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$in")
if (( $(python3 -c "print(int($src_len < $off+$X+$L))") )); then
  L=$(python3 -c "import math; print(math.floor($src_len-$off-$X))"); echo "원본 짧음 → 루프 길이 ${L}s로 줄임"
fi
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
# 같은 스트림을 두 번 자르므로 asplit으로 갈라 쓴다. SRC 자리에 입력 라벨을 넣는다.
cut="[SRC]asplit=2[s1][s2];
     [s1]atrim=start=$((off+X)):duration=${L},asetpts=PTS-STARTPTS[body];
     [s2]atrim=start=${off}:duration=${X},asetpts=PTS-STARTPTS[head];
     [body][head]acrossfade=d=${X}:c1=qsin:c2=qsin[loop]"
# 두 패스가 완전히 같은 필터 체인을 쓴다(게인 값만 다름). 체인이 다르면 ffmpeg가 스테레오→모노
# 변환 지점을 다르게 잡아 계수(1/2 vs 1/√2)가 바뀌고, 측정과 결과가 3 dB 어긋난다.
graph() { echo "[0:a]aformat=channel_layouts=mono,volume=${1}dB,alimiter=limit=0.89:level=false[lim];${cut//SRC/lim}"; }
# 1차: 게인 0으로 루프를 만들어 통합 음량(I)만 잰다
ffmpeg -v error -y -i "$in" -filter_complex "$(graph 0)" -map "[loop]" -t "${L}" -ar 32000 -c:a pcm_s16le "$work/raw.wav"
I=$(ffmpeg -nostats -i "$work/raw.wav" -af ebur128 -f null - 2>&1 | grep -E '^[[:space:]]+I:' | tail -1 | awk '{print $2}')
gain=$(python3 -c "print(round($target-($I),2))")
# 2차: 같은 체인에 게인만 넣어 최종 파일을 만든다. 리미터(-1 dBFS)는 자르기 전에 걸려 앞머리 무음이 없다
ffmpeg -v error -y -i "$in" -filter_complex "$(graph "$gain")" -map "[loop]" -t "${L}" -ar 32000 -c:a pcm_s16le "$out"
# 검증: 길이, 앞 5 ms 무음 여부, 이음새 앞/뒤 100 ms RMS, 2회 이어붙인 청취용 파일
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out")
python3 - "$out" <<'PY'
import sys,wave,struct,math
w=wave.open(sys.argv[1],'rb'); n=w.getnframes(); d=struct.unpack('<%dh'%n,w.readframes(n)); sr=w.getframerate()
rms=lambda s: 20*math.log10(max(1e-9,math.sqrt(sum(v*v for v in s)/len(s))/32768))
lead=next((i for i,v in enumerate(d) if v!=0),n)
print(f'  앞 무음 {lead/sr*1000:.2f} ms · 앞100ms RMS {rms(d[:sr//10]):.1f} dBFS · 뒤100ms RMS {rms(d[-sr//10:]):.1f} dBFS', end='')
PY
I2=$(ffmpeg -nostats -i "$out" -af ebur128 -f null - 2>&1 | grep -E '^[[:space:]]+I:' | tail -1 | awk '{print $2}'); echo " · 최종 I=${I2} LUFS"
x2=$(mktemp -t loop-x2).wav; ffmpeg -v error -y -i "$out" -filter_complex "[0:a][0:a]concat=n=2:v=0:a=1" "$x2"
printf '%s  길이=%.3fs (%d ms)  원본I=%s LUFS 게인=%sdB  청취용 2회 반복: %s\n' "$out" "$dur" "$(python3 -c "print(round($dur*1000))")" "$I" "$gain" "$x2"
