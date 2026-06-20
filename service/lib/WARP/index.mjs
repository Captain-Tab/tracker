// 统一 WARP / 代理封装：fetch(undici) + WS(ws + https-proxy-agent)。discovery / watch / 未来服务共用。
// Node 22 内置 fetch/WebSocket 不认 HTTP_PROXY 也不支持 WS CONNECT 代理，需显式处理。
// 零依赖：undici / ws / https-proxy-agent 仅在需要时按需 import（无代理/无 WS 场景不引入）。

export const PROXY_URL = process.env.HTTP_PROXY || process.env.http_proxy || null;

// fetch 走代理（undici ProxyAgent，Node 22 fetch 底层即 undici）。仅 PROXY_URL 存在时按需 import。
export async function installFetchProxy() {
  if (!PROXY_URL) return;
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import("undici");
    setGlobalDispatcher(new ProxyAgent(PROXY_URL));
    console.error(`[proxy] fetch 走代理 ${PROXY_URL}`);
  } catch {
    console.error("警告：未安装 undici，fetch 不走代理（真实 IP 会暴露）\n  npm install undici");
  }
}

// WS 走代理（Node 22 内置 WS 不支持 HTTP CONNECT 代理，统一用 ws 包），安装 globalThis.WebSocket。
// 缺 ws 包 → 抛错，由调用方决定（如 watcher 捕获后 process.exit(1)，保留现有行为）。
export async function installWsProxy() {
  const WS = (await import("ws")).default || (await import("ws")).WebSocket;
  const WSBase = WS.prototype ? WS : WS.WebSocket;
  let wsAgent = undefined;
  if (PROXY_URL) {
    try {
      const { HttpsProxyAgent } = await import("https-proxy-agent");
      wsAgent = new HttpsProxyAgent(PROXY_URL);
      console.error(`[proxy] WebSocket 走代理 ${PROXY_URL}`);
    } catch {
      console.error("警告：未安装 https-proxy-agent，WebSocket 不走代理（真实 IP 会暴露）\n  npm install https-proxy-agent");
    }
  }
  globalThis.WebSocket = function (url, protocols) {
    const opts = { handshakeTimeout: 10000, headers: { "User-Agent": "node" } };
    if (wsAgent) opts.agent = wsAgent;
    return new WSBase(url, protocols, opts);
  };
}
