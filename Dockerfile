# 진로교육 PPT 웹앱 — 프로덕션 이미지 (DB는 외부 Postgres/Supabase 사용)
FROM node:22-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-fund --no-audit

COPY server.js ./
COPY lib ./lib
COPY public ./public

ENV NODE_ENV=production \
    PORT=3000

# 실행 시 -e DATABASE_URL=... 필수 (Supabase 연결 문자열)
EXPOSE 3000
CMD ["node", "--no-warnings", "server.js"]
