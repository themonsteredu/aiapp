# 진로교육 PPT 웹앱 — 프로덕션 이미지 (외부 패키지 없음, 빌드 단계 불필요)
FROM node:22-alpine

WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

# SQLite 데이터 영구 저장 위치 — 반드시 볼륨으로 마운트할 것
VOLUME /data
EXPOSE 3000

CMD ["node", "--no-warnings", "server.js"]
