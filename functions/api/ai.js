export function onRequest({ request, env }) {
  if (!env.BORDERWISE_AI) {
    return Response.json({ error: 'AI 服务暂不可用。' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  return env.BORDERWISE_AI.fetch(request);
}
