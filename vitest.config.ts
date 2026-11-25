import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globals: false, testTimeout: 30000, hookTimeout: 60000, fileParallelism: false, setupFiles: ['./test/setup-env.ts'] },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
