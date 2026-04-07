import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Local dev: /api → http://localhost:3000 (override with VITE_DEV_API_PROXY in .env)
// Production: Vercel rewrites in vercel.json
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiProxyTarget = env.VITE_DEV_API_PROXY || 'http://localhost:3000'

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          timeout: 0,
          proxyTimeout: 0,
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
  }
})
