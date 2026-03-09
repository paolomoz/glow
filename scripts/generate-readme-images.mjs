#!/usr/bin/env node
// Generate README images using Gemini 2.0 Flash (imagen)
import { writeFileSync } from 'fs';
import { join } from 'path';

// Load .env manually
import { readFileSync } from 'fs';
const envPath = join(import.meta.dirname, '..', '.env');
const envContent = readFileSync(envPath, 'utf8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
}

const API_KEY = process.env.GOOGLE_API_KEY;
const OUTPUT_DIR = join(import.meta.dirname, '..', 'docs', 'images');

const images = [
  {
    name: 'hero-banner.png',
    prompt: `A sleek, futuristic digital illustration for a developer tool called "Glow". The image shows a modern website being dynamically transformed with glowing, luminous overlays. Personalized content blocks materialize in real-time with a soft golden-amber glow effect. The background is dark (#0d1117) with electric blue and warm amber accent lighting. Subtle circuit-board patterns and data flow lines connect the elements. Clean, minimal, premium tech aesthetic. No text. Wide banner format 3:1 ratio.`,
  },
  {
    name: 'architecture-overview.png',
    prompt: `A clean, modern technical architecture diagram illustration (NOT a flowchart with text). Shows 5 connected layers as glowing platforms floating in dark space: (1) a browser/website icon at top with signal waves emanating, (2) an intent-processing brain icon in the middle glowing amber, (3) a retrieval/database layer with content atoms as small glowing cubes, (4) a generation layer with AI/lightning bolt icons showing speed, (5) an assembly layer producing HTML blocks. Arrows flow between layers. Dark background (#0d1117), electric blue connections, amber glow highlights. Isometric 3D style. No text labels. Clean developer aesthetic.`,
  },
  {
    name: 'pipeline-flow.png',
    prompt: `A horizontal pipeline visualization showing 5 stages of real-time web content generation. Left to right: (1) A user clicking on a webpage sends glowing signal waves, (2) signals converge into a brain-shaped intent analyzer with amber glow, (3) content atoms are retrieved from a crystalline database structure, (4) an AI engine generates new content with electric sparks, (5) personalized HTML blocks smoothly inject into the webpage. The entire flow is connected by a luminous stream/ribbon. Timer showing "< 2.5s" concept through a fast-forward motion blur effect. Dark background, blue and amber palette. Wide format. No text.`,
  },
  {
    name: 'deployment-modes.png',
    prompt: `Three deployment modes illustrated side by side as glowing dioramas on a dark background: LEFT - a Chrome browser with a puzzle piece extension icon, glowing amber, representing demo mode. CENTER - a small JavaScript code tag icon connected to cloud edge nodes (Cloudflare), glowing electric blue, representing production mode. RIGHT - a full content repository with learning loop arrows, glowing purple, representing advanced mode. Each mode is on its own floating platform. Clean isometric 3D style. Premium tech aesthetic. Dark background (#0d1117). No text.`,
  },
];

async function generateImage(prompt, filename) {
  console.log(`Generating ${filename}...`);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT'],
          // responseMimeType: 'image/png',
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    console.error(`Failed ${filename}: ${response.status} ${err}`);
    return false;
  }

  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts) {
    console.error(`No parts in response for ${filename}:`, JSON.stringify(data).slice(0, 500));
    return false;
  }

  for (const part of parts) {
    if (part.inlineData) {
      const buf = Buffer.from(part.inlineData.data, 'base64');
      const outPath = join(OUTPUT_DIR, filename);
      writeFileSync(outPath, buf);
      console.log(`  Saved ${outPath} (${(buf.length / 1024).toFixed(0)} KB)`);
      return true;
    }
  }

  console.error(`No image data in response for ${filename}`);
  return false;
}

let success = 0;
for (const img of images) {
  const ok = await generateImage(img.prompt, img.name);
  if (ok) success++;
}
console.log(`\nGenerated ${success}/${images.length} images`);
