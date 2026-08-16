import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // 라우트 청크(App.tsx의 lazy)와 별개로, 거의 바뀌지 않는 의존성을 따로 떼어
        // 앱 코드만 수정했을 때 브라우저 캐시가 그대로 살아있게 한다.
        // 차트 라이브러리는 쓰는 화면이 일부라 분리 효과가 특히 크다.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-data': ['@tanstack/react-query', 'axios'],
          'vendor-charts': ['lightweight-charts'],
        },
      },
    },
  },
  server: {
    port: 5173,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
