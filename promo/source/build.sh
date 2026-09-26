#!/usr/bin/env bash
# 전체 재생성 순서 (로컬 서버 + 더미 DB 가 떠 있어야 함 — README.md 참고)
set -e
FF=${FFMPEG:-/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2}
if [ "$1" = "record" ]; then
  node slides.mjs && node seed.mjs
  # 녹화용 더미 계정의 첫 로그인 비밀번호 변경 화면을 건너뛴다 (로컬 테스트 DB 전용)
  psql "${DATABASE_URL:-postgresql://postgres@127.0.0.1:5433/moalab}" -c 'UPDATE users SET must_change_password = false'
  node seed-project.mjs
  for c in landing decks session join schedule blocked security projteacher projstudent dashboard; do node go.mjs $c; done
  for c in clips/*.mp4; do n=$(basename $c .mp4); rm -rf frames/$n; mkdir -p frames/$n; $FF -loglevel error -i $c -q:v 2 frames/$n/%05d.jpg; done
fi
node render.mjs
python3 music.py
node srt.mjs > ../moalab-promo.srt
$FF -y -loglevel error -framerate 30 -i out/%05d.jpg -i music.wav -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -shortest -movflags +faststart ../moalab-promo.mp4
