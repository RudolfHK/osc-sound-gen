import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base path so assets load correctly under both file:// (Electron)
  // and any web host root. Swap to '/subdir/' only if deploying to a subdirectory.
  base: './',
});
