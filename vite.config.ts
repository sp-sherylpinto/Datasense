import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:8000',
        changeOrigin: true,
      },
      '/ai': {
        target: process.env.VITE_API_URL || 'http://localhost:8000',
        changeOrigin: true,
      },
    }
  },
  build: {
    rollupOptions: {
      output: {
        // Split heavy libs out of the main bundle so initial paint is fast.
        // ForceGraph2D + d3-force pull in ~600KB and are only used by the
        // Network tab; recharts is ~150KB and only used in result components.
        // xlsx is ~400KB and only used when exporting.
        manualChunks: {
          'force-graph':   ['react-force-graph-2d'],
          'xlsx':          ['xlsx'],
          'prismjs':       ['prismjs/components/prism-core', 'prismjs/components/prism-clike', 'prismjs/components/prism-sql'],
          'framer-motion': ['framer-motion'],
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
})
