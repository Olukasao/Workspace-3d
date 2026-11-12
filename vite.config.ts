import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const API = process.env.OFFICE3D_API ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  // 127.0.0.1 explícito: no Windows o padrão pode escutar só em ::1 (IPv6), e o navegador que resolve localhost para IPv4 não conecta
  server: { host: '127.0.0.1', port: Number(process.env.WEB_PORT ?? 5173), strictPort: true, proxy: { '/api': { target: API, changeOrigin: false } } },
  build: { assetsDir: 'static', chunkSizeWarningLimit: 900, rollupOptions: { output: { manualChunks: { three: ['three'], r3f: ['@react-three/fiber', '@react-three/drei'] } } } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 20000 },
});
