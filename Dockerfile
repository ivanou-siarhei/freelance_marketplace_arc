# ArcWork API: the Bun server in server/ (jobs, bids, disputes, sign-in, chain indexer).
# The web app is deployed separately (for example on Vercel).
FROM oven/bun:1.3
WORKDIR /app

# The API only needs viem at runtime, so install just that instead of the whole web app's dependencies.
RUN echo '{"name":"arcwork-api","private":true,"type":"module","dependencies":{"viem":"2.57.5"}}' > package.json \
 && bun install

COPY server ./server
COPY src/lib ./src/lib
COPY src/onchain-facts.ts ./src/onchain-facts.ts

ENV API_HOST=0.0.0.0
EXPOSE 8787
CMD ["bun", "run", "server/index.ts"]
