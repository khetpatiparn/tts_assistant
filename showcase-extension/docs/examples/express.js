// Showcase Scanner destination — Node + Express (protocol showcase-scanner/1)
//
// Run:
//   npm i express
//   SCANNER_TOKEN=<random string, at least 32 chars> node express.js
//   (generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
// Destination link to paste into the extension:  http://localhost:3000/scanner?token=<SCANNER_TOKEN>
// (use https for anything that is not localhost/127.0.0.1)
const crypto = require('node:crypto')
const express = require('express')

const PROTOCOL = 'showcase-scanner/1'
const TOKEN = process.env.SCANNER_TOKEN
if (!TOKEN || TOKEN.length < 32) {
  console.error('Set SCANNER_TOKEN to a random string of at least 32 chars (64 hex chars recommended).')
  process.exit(1)
}

// In-memory storage. Replace with a database for real use.
const products = new Map() // productId (string) -> product record
let lastReceivedAt = null

const app = express()

// The extension POSTs JSON as text/plain, so read every body as text and JSON.parse it ourselves.
app.use(express.text({ type: '*/*', limit: '10mb' }))

// Every response (including errors) must carry CORS headers.
app.use((req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
  })
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// commissionRate is number | string | null, in hundredths of a percent (1200 = 12%).
function commissionPercent(raw) {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
  return typeof n === 'number' && Number.isFinite(n) ? n / 100 : null
}

function tokenOk(given) {
  if (typeof given !== 'string') return false
  const a = Buffer.from(given)
  const b = Buffer.from(TOKEN)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

app.use('/scanner', (req, res, next) => {
  if (!tokenOk(req.query.token)) return res.status(401).json({ error: 'unauthorized' })
  next()
})

app.get('/scanner', (req, res) => {
  res.json({ protocol: PROTOCOL, productIds: [...products.keys()], lastReceivedAt })
})

app.post('/scanner', (req, res) => {
  let body
  try {
    body = JSON.parse(typeof req.body === 'string' ? req.body : '')
  } catch {
    return res.status(400).json({ error: 'invalid JSON body' })
  }
  if (!body || !Array.isArray(body.products)) {
    return res.status(400).json({ error: 'products must be an array' })
  }
  let saved = 0
  let skipped = 0
  for (const p of body.products) {
    // productId is a string of digits longer than 2^53 - never convert it to a number.
    if (!p || typeof p.productId !== 'string' || p.productId === '' || p.hasStatusPopup === true) {
      skipped++
      continue
    }
    products.set(p.productId, {
      productId: p.productId,
      title: p.title,
      priceDisplay: p.priceDisplay ?? null,
      commissionPercent: commissionPercent(p.commissionRate), // 1200 -> 12 (%)
      shopName: p.shopName ?? null,
      categoryLabel: p.categoryLabel ?? null,
      imageUrls: Array.isArray(p.imageUrls) ? p.imageUrls : [],
      receivedAt: new Date().toISOString(),
    }) // upsert: the same productId may arrive many times
    saved++
  }
  lastReceivedAt = new Date().toISOString()
  res.json({ ok: true, saved, skipped })
})

const port = Number(process.env.PORT ?? 3000)
app.listen(port, () => console.log(`listening on http://localhost:${port}/scanner?token=<SCANNER_TOKEN>`))
