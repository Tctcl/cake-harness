import { buildServer } from './server.js'

const server = buildServer()

server.listen({ host: '127.0.0.1', port: 8080 }, (err, address) => {
  if (err) {
    console.error(err)
    process.exit(1)
  }
  console.log(`Server listening at ${address}`)
})
