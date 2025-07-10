/*
 * Node.js Express with in-process job queue + worker model
 * Ensures immediate response on POST /analyze to avoid Railway 502
 * POST /analyze  --> { jobId }
 * GET  /result/:jobId --> { status, result?, error? }
 */

const express = require('express');
const axios   = require('axios');
const cheerio = require('cheerio');
const pLimit  = require('p-limit');
const psl     = require('psl');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json({ limit: '10kb' }));

// In-memory job store & queue
const jobs  = new Map();               // jobId -> { status, result?, error? }
const queue = [];
let isProcessing = false;
const limit = pLimit(1);

// Health check
app.get('/', (_req, res) => res.send('OK'));

// Enqueue analysis job with immediate response
app.post('/analyze', (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // Generate jobId and respond immediately
  const jobId = uuidv4();
  jobs.set(jobId, { status: 'pending' });
  res.json({ jobId });

  // Schedule job processing in next tick to avoid blocking response
  process.nextTick(() => {
    queue.push({ jobId, url });
    processQueue();
  });
});

// Fetch job result or status
app.get('/result/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// Worker: process queue one at a time
async function processQueue() {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;

  while (queue.length > 0) {
    const { jobId, url } = queue.shift();
    try {
      const result = await limit(() => analyzeGTM(url));
      jobs.set(jobId, { status: 'done', result });
    } catch (err) {
      console.error(`Error in job ${jobId}:`, err);
      jobs.set(jobId, { status: 'error', error: err.message });
    }
  }

  isProcessing = false;
}

// GTM analysis using axios + cheerio
async function analyzeGTM(url) {
  const response = await axios.get(url, {
    timeout: 7000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Node.js)',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html'
    }
  });

  const html = response.data;
  const $    = cheerio.load(html);
  const hostname   = new URL(url).hostname;
  const mainDomain = psl.get(hostname) || hostname;

  let isGTMFound = false;
  let isProxified = false;
  let gtmDomain = '';

  $('script').each((_, el) => {
    if (isGTMFound) return;
    const src    = $(el).attr('src')  || '';
    const inline = $(el).html()      || '';

    if (src.includes('?id=GTM-')) {
      isGTMFound = true;
      const full  = src.startsWith('//') ? 'https:' + src : src;
      try {
        const host = new URL(full).hostname;
        gtmDomain = host;
        if (!host.includes('google') && host.endsWith(mainDomain)) {
          isProxified = true;
        }
      } catch {}
      return;
    }

    const inlineMatch = inline.match(/GTM-[A-Z0-9]+/);
    if (inlineMatch) {
      isGTMFound = true;
      if (new RegExp(`\\b${mainDomain.replace('.', '\\.')}`, 'i').test(inline)) {
        isProxified = true;
        gtmDomain = hostname;
      }
    }
  });

  if (!isGTMFound) {
    $('script').each((_, el) => {
      const content = ($(el).attr('src') || '') + ($(el).html() || '');
      if (content.includes('?aw=')) {
        isGTMFound = true;
        if (content.includes(mainDomain)) {
          isProxified = true;
          gtmDomain = hostname;
        }
        return false;
      }
    });
  }

  return { url, gtmDomain, isProxified, isGTMFound };
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});