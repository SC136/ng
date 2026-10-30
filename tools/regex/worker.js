// Runs a regex off the main thread so a runaway pattern can be stopped with terminate().
import { run } from './regex.js';

self.addEventListener('message', ({ data }) => {
  const { id, ...input } = data;
  try {
    self.postMessage({ id, ok: true, ...run(input) });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error.message });
  }
});
