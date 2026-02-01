import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// WAŻNE: zmień 'spatial-audio-lab' na nazwę Twojego repo jeśli jest inna
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/spatial-audio-lab/' : '/',
}))
