#!/usr/bin/env bash
# Final mux: silent.mp4 + audio/soundtrack.wav → ../brag.mp4, mastered to −14 LUFS, with the poster (../brag.jpg)
# baked in as frame 0 (replaced, not added, so the duration and sync stay the same).
# Usage: ./finish.sh <poster-time-in-seconds>
#        NAME=brag-reel PAGE=reel.html W=1080 H=1920 ./finish.sh <t>   (the Instagram Reel)
set -euo pipefail
cd "$(dirname "$0")"
POSTER_T=${1:?poster time}
NAME=${NAME:-brag}
SILENT=${SILENT:-$([ "$NAME" = brag ] && echo silent.mp4 || echo "silent-${NAME#brag-}.mp4")}
STILLS=${STILLS:-$([ "$NAME" = brag ] && echo stills || echo "stills-${NAME#brag-}")}
export STILLS

node render.mjs --only "$POSTER_T" >/dev/null
ffmpeg -v error -y -i "$STILLS/t$(printf '%.2f' "$POSTER_T").png" -q:v 2 "../$NAME.jpg"

ffmpeg -v error -stats -y -i "$SILENT" -i audio/soundtrack.wav -loop 1 -i "../$NAME.jpg" \
  -filter_complex "[2:v]format=yuv420p,trim=end_frame=1[p];[0:v][p]overlay=enable='eq(n,0)':eof_action=pass,format=yuv420p[v];
                   [1:a]loudnorm=I=-14:TP=-1.5:LRA=9,aresample=48000[a]" \
  -map "[v]" -map "[a]" -t 22 \
  -c:v libx264 -preset slow -crf 16 -profile:v high -pix_fmt yuv420p -r 30 \
  -c:a aac -b:a 192k -movflags +faststart "../$NAME.mp4"

ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_name,width,height,r_frame_rate -of compact "../$NAME.mp4"
