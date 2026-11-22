export function limitResponseBody(response, limit) {
  if (!response.ok || !response.body) return response;
  if (Number(response.headers.get('Content-Length')) > limit) {
    void response.body.cancel().catch(() => {});
    throw new Error('Upstream response exceeds the size limit');
  }

  let size = 0;
  const stream = response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > limit) {
        controller.error(new Error('Upstream response exceeds the size limit'));
        return;
      }
      controller.enqueue(chunk);
    },
  }));
  return new Response(stream, { status: response.status, headers: response.headers });
}
