import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Change base to '/<repo-name>/' if your repository name differs.
export default defineConfig({
  plugins: [react()],
  base: '/console-andrea/'
})
