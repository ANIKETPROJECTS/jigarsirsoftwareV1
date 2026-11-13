import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'

export default defineConfig({
  plugins: [
    react(),
    legacy({
      // Target Chrome 87+ and Firefox 78+ which are the minimum for React 19 + MUI v9.
      // This covers Chrome 109 (last Win7 Chrome) and current Firefox on Win7.
      // IE11 cannot be supported — React 19 is fundamentally incompatible.
      targets: ['chrome >= 87', 'firefox >= 78', 'safari >= 14'],
    }),
  ],
})
