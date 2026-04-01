import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://165.245.188.54',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: [
      {
        find: '@/src',
        replacement: path.resolve(__dirname, './src'),
      },
      {
        find: '@',
        replacement: path.resolve(__dirname, './src'),
      },
    ],
  },
  optimizeDeps: {
    include: ['react-is', 'recharts'],
  },
})
