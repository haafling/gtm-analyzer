/*
 * GTM Analyzer with in-process job queue + worker model
 * - GET  /            → 'OK' (health check)
 * - POST /analyze     → { jobId } (immediate)
 * - GET  /result/:id  → { status, result?, error? }
 */

const express = require('express');
const axios   = require('axios');
const cheerio = require('cheerio');
const pLimit  = require('p-limit');
const psl     = require('psl');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json({ limit: '10kb' }));

// In-memory job storage & queue
const jobs = new Map();
const queue = [];
let isProcessing = false;
const limit = pLimit(1);

// 1) HEALTH CHECK (must be FIRST)
app.get('/', (_req, res) => {
  res.send('OK');
});

// 2) ENQUEUE ANALYSE
app.post('/analyze', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }

  const jobId = uuidv4();
  jobs.set(jobId, { status: 'pending' });
  res.json({ jobId });

  // schedule work after response is flushed
  setImmediate(() => {
    queue.push({ jobId, url });
    processQueue();
  });
});

// 3) FETCH RESULT
app.get('/result/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// 4) WORKER: process one job at a time
async function processQueue() {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;

  while (queue.length > 0) {
    const { jobId, url } = queue.shift();
    try {
      const result = await limit(() => analyzeGTM(url));
      jobs.set(jobId, { status: 'done', result });
    } catch (err) {
      console.error(`Job ${jobId} failed:`, err);
      jobs.set(jobId, { status: 'error', error: err.message });
    }
  }

  isProcessing = false;
}

// 5) GTM detection using axios + cheerio
async function analyzeGTM(url) {
  const { data: html } = await axios.get(url, {
    timeout: 7000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Node.js)',
      'Accept': 'text/html'
    }
  });
  const $ = cheerio.load(html);
  const host       = new URL(url).hostname;
  const mainDomain = psl.get(host) || host;

  let isGTMFound = false, isProxified = false, gtmDomain = '';

  $('script').each((_, el) => {
    if (isGTMFound) return;
    const src = $(el).attr('src')||'';
    const inl = $(el).html()||'';
    if (src.includes('?id=GTM-')) {
      isGTMFound = true;
      const full = src.startsWith('//') ? 'https:'+src : src;
      try {
        const d = new URL(full).hostname;
        gtmDomain = d;
        if (!d.includes('google') && d.endsWith(mainDomain)) isProxified = true;
      } catch{}
    } else if (/GTM-[A-Z0-9]+/.test(inl)) {
      isGTMFound = true;
      if (new RegExp(`\\b${mainDomain.replace('.', '\\.')}`, 'i').test(inl)) {
        isProxified = true; gtmDomain = host;
      }
    }
  });

  if (!isGTMFound) {
    $('script').each((_, el) => {
      const txt = ($(el).attr('src')||'')+($(el).html()||'');
      if (txt.includes('?aw=')) {
        isGTMFound = true;
        if (txt.includes(mainDomain)) { isProxified = true; gtmDomain = host; }
        return false;
      }
    });
  }

  return { url, gtmDomain, isProxified, isGTMFound };
}

// START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});