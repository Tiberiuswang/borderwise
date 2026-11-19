const USITC_EXPORT = 'https://hts.usitc.gov/reststop/exportList';
const USITC_ARCHIVE = 'https://www.usitc.gov/harmonized_tariff_information/hts/archive/list';
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const RELEASE_LINK = /href=["'](\/sites\/default\/files\/tata\/hts\/hts_(\d{4})_(revision_(\d+)|basic_edition)_json\.json)["']/i;

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

async function fetchLatestRelease() {
  const index = await fetch(USITC_ARCHIVE, { redirect: 'manual', signal: AbortSignal.timeout(5_000) });
  if (!index.ok) throw new Error('USITC archive unavailable');
  const match = RELEASE_LINK.exec(await index.text());
  if (!match) throw new Error('No USITC archive release found');
  const [, path, year, , revision] = match;
  const edition = revision ? `${year} HTS Revision ${revision}` : `${year} HTS Basic Edition`;
  const file = await fetch(new URL(path, USITC_ARCHIVE), {
    headers: { Accept: 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(12_000),
  });
  if (!file.ok || !file.body || Number(file.headers.get('Content-Length')) > MAX_ARCHIVE_BYTES) {
    file.body?.cancel().catch(() => {});
    throw new Error('USITC release download unavailable');
  }
  let bytes = 0;
  const body = file.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > MAX_ARCHIVE_BYTES) throw new Error('Oversized USITC release');
      controller.enqueue(chunk);
    },
  }));
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Borderwise-Tariff-Edition': edition,
    },
  });
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
      redirect: 'manual',
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok || Number(response.headers.get('Content-Length')) > MAX_RESPONSE_BYTES) {
      response.body?.cancel().catch(() => {});
      throw new Error('USITC response unavailable');
    }
    const rows = await readRows(response);
    return Response.json(rows, { headers: { 'Cache-Control': 'public, max-age=180' } });
  } catch {
    try {
      return await fetchLatestRelease();
    } catch {
      return Response.json({ error: 'usitc_unavailable' }, { status: 502 });
    }
  }
}
