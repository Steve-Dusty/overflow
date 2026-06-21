import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import fs from 'fs'
import path from 'path'

/**
 * Vite plugin to serve .parquet files with HTTP Range Request support.
 * hyparquet needs byte-range reads for large files (165 MB+ lidar data).
 */
function parquetRangePlugin(): Plugin {
  return {
    name: 'parquet-range-support',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.endsWith('.parquet')) return next()

        const filePath = path.join(process.cwd(), 'public', decodeURIComponent(req.url))
        if (!fs.existsSync(filePath)) return next()

        const stat = fs.statSync(filePath)
        const total = stat.size

        // Set Accept-Ranges header
        res.setHeader('Accept-Ranges', 'bytes')
        res.setHeader('Content-Type', 'application/octet-stream')
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length')

        const rangeHeader = req.headers.range
        if (rangeHeader) {
          const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
          if (match) {
            const start = parseInt(match[1], 10)
            const end = match[2] ? parseInt(match[2], 10) : total - 1
            const chunkSize = end - start + 1

            res.writeHead(206, {
              'Content-Range': `bytes ${start}-${end}/${total}`,
              'Content-Length': chunkSize,
            })
            fs.createReadStream(filePath, { start, end }).pipe(res)
            return
          }
        }

        // No Range header — serve full file
        res.setHeader('Content-Length', total)
        res.writeHead(200)
        fs.createReadStream(filePath).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), parquetRangePlugin()],
})
