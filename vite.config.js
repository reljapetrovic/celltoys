import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  base: '/celltoys/',
  plugins: [basicSsl()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        readingLight: resolve(__dirname, 'reading-light/index.html'),
      },
    },
  },
  test: {
    environment: 'node',
  },
});
