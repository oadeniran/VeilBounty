import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const web = (p) => fileURLToPath(new URL(`./web/${p}`, import.meta.url));

// Dev server: serve /demo from demo.html, as the production server does.
const pages = { name: 'veilbounty-pages', configureServer(server) {
  server.middlewares.use((req, _res, next) => { if (req.url === '/demo' || req.url.startsWith('/demo?') || req.url.startsWith('/demo#')) req.url = req.url.replace('/demo', '/demo.html'); next(); });
} };

export default defineConfig({
  root: 'web',
  plugins: [pages],
  publicDir: 'public',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __NOIR_VERSION__: JSON.stringify(pkg.dependencies['@noir-lang/noir_js']),
    __BB_VERSION__: JSON.stringify(pkg.dependencies['@aztec/bb.js']),
  },
  build: {
    outDir: '../dist', emptyOutDir: true, target: 'esnext', sourcemap: false, assetsInlineLimit: 0,
    rollupOptions: { input: { index: web('index.html'), demo: web('demo.html') } },
  },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@noir-lang/noirc_abi', '@noir-lang/acvm_js', '@aztec/bb.js'] },
  server: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }, proxy: { '/api': 'http://127.0.0.1:8787' } },
});
