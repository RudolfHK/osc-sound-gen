import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

/**
 * The MP3 encoder (@breezystack/lamejs, a port of LAME) is LGPL-3.0. It is
 * bundled as its own worker file so it stays replaceable, and its license
 * notice ships alongside the app as the LGPL requires.
 */
function shipLgplNotice(): Plugin {
  return {
    name: 'ship-lgpl-notice',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'licenses/lamejs-LGPL-3.0.txt',
        source:
          'The MP3 encoder in this application (assets/mp3.worker-*.js) is @breezystack/lamejs,\n' +
          'a JavaScript port of LAME, licensed under the GNU LGPL v3.0.\n' +
          'Source: https://www.npmjs.com/package/@breezystack/lamejs\n' +
          'Full license text: https://www.gnu.org/licenses/lgpl-3.0.txt\n' +
          'You may replace that worker file with your own build of the library.\n\n' +
          '--- Notice included with the package ---\n\n' +
          readFileSync('node_modules/@breezystack/lamejs/LICENSE', 'utf8'),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), shipLgplNotice()],
  // Relative base path so assets load correctly under both file:// (Electron)
  // and any web host root. Swap to '/subdir/' only if deploying to a subdirectory.
  base: './',
});
