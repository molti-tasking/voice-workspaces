#!/usr/bin/env node
/**
 * One origin for `pnpm dev`, so the browser sees the same shape as production.
 *
 * In production Traefik puts the web app and the realtime service on one public
 * domain, with `/rt` routed to realtime. In development they are two processes
 * on two ports, which breaks two things that are easy to paper over badly:
 *
 *   - The WebSocket would be cross-origin, so the realtime service's origin
 *     check would have to be disabled in dev — and a check that is off in dev is
 *     a check nobody has tested.
 *   - `pnpm tunnel` points cloudflared at a single port, so a phone could reach
 *     the recorder but never the socket. Testing talk-back on an actual phone
 *     is the whole point of the tunnel.
 *
 * So: listen on one port, forward `/rt` to realtime and everything else to
 * Next, including the upgrade handshake. Then dev, tunnel and production all
 * mean "same origin, /rt prefix", and `pnpm tunnel` points here.
 *
 *     node scripts/dev-proxy.mjs
 *     PROXY_PORT=3100 WEB_PORT=3000 REALTIME_PORT=3001 node scripts/dev-proxy.mjs
 */
import { createServer, request } from "node:http";
import { connect } from "node:net";

const PROXY_PORT = Number(process.env.PROXY_PORT ?? 3100);
const WEB_PORT = Number(process.env.WEB_PORT ?? 3000);
const REALTIME_PORT = Number(process.env.REALTIME_PORT ?? 3001);
const RT_PREFIX = "/rt";

const targetPort = (url = "/") => (url.startsWith(RT_PREFIX) ? REALTIME_PORT : WEB_PORT);

const server = createServer((req, res) => {
  const port = targetPort(req.url);

  const upstream = request(
    {
      host: "127.0.0.1",
      port,
      method: req.method,
      path: req.url,
      // Forwarded verbatim, including Origin: the realtime service's origin
      // check must see what the browser actually sent, or dev is not testing
      // the thing production runs.
      headers: req.headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstream.on("error", (err) => {
    // Next and realtime start independently under `turbo run dev`, so one being
    // slow to boot is normal rather than an error worth a stack trace.
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end(`dev-proxy: :${port} is not up yet (${err.message})\n`);
  });

  req.pipe(upstream);
});

/**
 * WebSocket upgrades.
 *
 * `http.request` cannot carry an upgrade, so replay the handshake down a raw
 * socket and then pipe both directions. Next uses upgrades too (HMR), so this
 * must route by path rather than assuming every upgrade is talk-back.
 */
server.on("upgrade", (req, socket, head) => {
  const port = targetPort(req.url);
  const upstream = connect(port, "127.0.0.1", () => {
    const headers = Object.entries(req.headers)
      .flatMap(([key, value]) => (Array.isArray(value) ? value.map((v) => [key, v]) : [[key, value]]))
      .map(([key, value]) => `${key}: ${value}`)
      .join("\r\n");

    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`);
    if (head?.length) upstream.write(head);

    upstream.pipe(socket);
    socket.pipe(upstream);
  });

  const drop = () => {
    socket.destroy();
    upstream.destroy();
  };
  upstream.on("error", drop);
  socket.on("error", drop);
});

server.listen(PROXY_PORT, () => {
  console.log(
    `dev-proxy on http://localhost:${PROXY_PORT}  →  ${RT_PREFIX} :${REALTIME_PORT}, everything else :${WEB_PORT}`,
  );
  console.log(`point \`pnpm tunnel\` here, and set BETTER_AUTH_URL to match`);
});
