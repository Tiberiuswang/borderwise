const USITC_EXPORT = 'https://hts.usitc.gov/reststop/exportList';
const MAX_RESPONSE_BYTES = 1024 * 1024;

async function readRows(response) {
  if (!response.body) throw new Error('Empty USITC response');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Oversized USITC response');
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    const rows = JSON.parse(chunks.join(''));
    if (!Array.isArray(rows)) throw new Error('Unexpected USITC response');
    return rows;
  } catch (error) {
    reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function onRequestGet({ request }) {
  const code = new URL(request.url).searchParams.get('code');
  if (!/^(?:[0-9]{6}|[0-9]{8}|[0-9]{10})$/.test(code ?? '')) {
    return Response.json({ error: 'invalid_code' }, { status: 400 });
  }

  const prefix = code.slice(0, 8);
  const from = [prefix.slice(0, 4), prefix.slice(4, 6), prefix.slice(6)].filter(Boolean).join('.');
  const to = prefix.length === 6 ? `${from}.99.99` : `${from}.99`;
  const upstream = new URL(USITC_EXPORT);
  upstream.search = new URLSearchParams({ format: 'JSON', styles: 'false', from, to });

  try {
    const response = await fetch(upstream, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(9_000),
    });
    if (!response.ok || Number(response.headers.get('Content-Length')) > MAX_RESPONSE_BYTES) {
      response.body?.cancel().catch(() => {});
      throw new Error('USITC response unavailable');
    }
    const rows = await readRows(response);
    return Response.json(rows, { headers: { 'Cache-Control': 'public, max-age=180' } });
  } catch {
    return Response.json({ error: 'usitc_unavailable' }, { status: 502 });
  }
}
