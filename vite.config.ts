import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const API = process.env.OFFICE3D_API ?? 'http://localhost:8787';

/**
 * Blocos de fornecedores. O que é exclusivo de um ambiente (Three.js e React Three Fiber no 3D; Phaser no 2D) NÃO pode ser
 * importado pelo pacote principal: do contrário o navegador baixaria o motor do ambiente que não está em uso.
 * React, Zustand e os ícones são comuns e ficam num bloco próprio; o resto cai nos blocos dos ambientes (carregados sob demanda).
 */
function manualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;
  if (/node_modules[/](react|react-dom|scheduler|zustand|lucide-react|use-sync-external-store)[/]/.test(id)) return 'vendor';
  if (/node_modules[/]three[/]/.test(id)) return 'three';
  if (/node_modules[/]phaser[/]/.test(id)) return 'phaser';
  return undefined;
}

export default defineConfig({
  plugins: [react()],
  // 127.0.0.1 explícito: no Windows o padrão pode escutar só em ::1 (IPv6), e o navegador que resolve localhost para IPv4 não conecta
  server: { host: '127.0.0.1', port: Number(process.env.WEB_PORT ?? 5173), strictPort: true, proxy: { '/api': { target: API, changeOrigin: false } } },
  build: { assetsDir: 'static', chunkSizeWarningLimit: 900, rollupOptions: { output: { manualChunks } } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 20000 },
});
