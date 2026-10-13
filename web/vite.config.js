// Vite 构建配置：启用 Vue，并在本地开发时把 /api 转发给 Spring Boot。
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // The Electron build is loaded with file://, so absolute /assets URLs
  // would point at the filesystem root instead of web/dist.
  base: './',
  server: {
    proxy: {
      '/api': process.env.CSDEMO_DEV_BACKEND || 'http://localhost:8091'
    }
  }
})
