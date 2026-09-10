import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const saveDirectory = resolve(process.env.CHRONICLE_DATA_DIR || '.chronicle').replaceAll('\\', '/');
export default defineConfig({ plugins: [react()], server: {
  watch: { ignored: ['**/.chronicle/**', `${saveDirectory}/**`, '**/*.sqlite', '**/*.sqlite-*'] },
  fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.chronicle/**', `${saveDirectory}/**`, '**/*.sqlite', '**/*.sqlite-*'] },
} });
