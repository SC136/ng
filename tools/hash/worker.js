// Hashes text or a file off the main thread so big files don't freeze the page.
import { digestAll } from './hash.js';

self.onmessage = async ({ data }) => {
  const { id, file, text, hmacKey } = data;
  try {
    const bytes = file ? new Uint8Array(await file.arrayBuffer()) : new TextEncoder().encode(text);
    self.postMessage({ id, type: 'progress', fraction: 0 });
    const results = await digestAll(bytes, {
      hmacKey,
      onProgress: (fraction) => self.postMessage({ id, type: 'progress', fraction }),
    });
    self.postMessage({ id, type: 'done', results, size: bytes.length });
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error?.message || String(error) });
  }
};
