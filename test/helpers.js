// Test helpers: a mock fetch that never touches the network.
export function jsonRes(body, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  };
}

// handler(url: URL, opts) => Response-like | plain body object. Records calls.
export function mockFetch(handler) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url: String(url), opts });
    const r = await handler(new URL(url), opts);
    return r && typeof r.json === 'function' ? r : jsonRes(r);
  };
  fn.calls = calls;
  return fn;
}

export const noSleep = async () => {};
