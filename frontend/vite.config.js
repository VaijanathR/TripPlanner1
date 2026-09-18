import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    globals: true,
    pool: 'threads',
    // Starting multiple workers concurrently times out here under
    // WSL/Windows cross-filesystem I/O contention (each worker start is
    // slow, and starting several at once pushes one past the timeout) --
    // confirmed by the failing file passing cleanly on its own. Running
    // files sequentially avoids that contention; harmless on a fast
    // native Linux CI runner, just not parallelized there either.
    fileParallelism: false,
  },
})
