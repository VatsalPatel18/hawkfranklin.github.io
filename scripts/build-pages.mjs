import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const outputRoot = join(repositoryRoot, 'dist');
const siteOrigin = 'https://hawkfranklin.in';

// These are the only pages that should compete for organic search visibility.
const indexablePages = [
  'index.html',
  'about.html',
  'aclis.html',
  'research.html',
  'ai-in-diabetes.html',
  'graph_research.html',
  'survival_research.html',
  'tabFM_research.html',
  'publications.html',
  'vision.html',
  'products/pelliscope.html',
  'products/dermai-ehs-kiosk.html',
  'products/aura.html',
  'products/oncogemma.html',
  'products/omics_copilot.html',
  'products/graph_attention_multiomics.html',
  'products/ml_copilot_agent.html',
  'products/aura-privacy.html',
  'careers.html',
  'contact.html',
  'schedule.html',
  'partnership.html',
];

// These remain available for users, downloads, or direct sharing but must not
// be indexed as standalone search results.
const supportPages = [
  '404.html',
  'privacy.html',
  'downloads/index.html',
  'fdroid/repo/index.html',
  'derma-ai-brochure.html',
  'derma-ai-brochure_v2.html',
  'derma-ai-brochure_v3.html',
  'distribution/pelliscope/feb-briefing.html',
  'investors/gab2.html',
];

const rootAssets = [
  'CNAME',
  'robots.txt',
  'ACLIS_logo.png',
  'Abhijeet Patel.jpg',
  'Ananya_Pal.jpg',
  'Saurav_Roy.jpeg',
  'Vatsal_Patel.jpg',
];

const individualAssets = [
  'conference/arab_health_26/image1_expo.jpg',
  'conference/arab_health_26/image2_expo.jpg',
  'conference/arab_health_26/image4_expo.jpg',
  'conference/arab_health_26/image5_expo.jpg',
  'downloads/aura/AURA.apk',
  'downloads/derma_ai.zip',
  'investors/EHS_acknoledgment_letter.pdf',
  'investors/angled.jpeg',
  'investors/close_up.jpeg',
  'investors/context.jpeg',
  'products/angled.jpeg',
  'products/close_up.jpeg',
  'products/context.jpeg',
];

const sourcePath = (path) => join(repositoryRoot, path);
const outputPath = (path) => join(outputRoot, path);

async function copy(path) {
  await mkdir(dirname(outputPath(path)), { recursive: true });
  await copyFile(sourcePath(path), outputPath(path));
}

async function copyTree(path, { omitHtml = false } = {}) {
  const entries = await readdir(sourcePath(path), { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    if (omitHtml && extname(entry.name).toLowerCase() === '.html') continue;

    const childPath = join(path, entry.name);
    if (entry.isDirectory()) {
      await copyTree(childPath, { omitHtml });
    } else if (entry.isFile()) {
      await copy(childPath);
    }
  }
}

function canonicalUrl(page) {
  return page === 'index.html' ? `${siteOrigin}/` : `${siteOrigin}/${page}`;
}

function lastModified(page) {
  try {
    return execFileSync(
      'git',
      ['log', '-1', '--format=%cs', '--', page],
      { cwd: repositoryRoot, encoding: 'utf8' },
    ).trim();
  } catch {
    return '';
  }
}

function buildSitemap() {
  const urls = indexablePages.map((page) => {
    const modified = lastModified(page);
    const lastmod = modified ? `<lastmod>${modified}</lastmod>` : '';
    return `  <url><loc>${canonicalUrl(page)}</loc>${lastmod}</url>`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

function localTarget(rawUrl, currentPage) {
  if (!rawUrl || rawUrl.startsWith('#')) return null;
  if (/^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(rawUrl)) return null;

  const baseUrl = new URL(currentPage, `${siteOrigin}/`);
  const resolvedUrl = new URL(rawUrl, baseUrl);
  if (resolvedUrl.origin !== siteOrigin) return null;

  let path = decodeURIComponent(resolvedUrl.pathname).replace(/^\//, '');
  if (!path || path.endsWith('/')) path += 'index.html';
  return path;
}

async function walk(path = '') {
  const entries = await readdir(outputPath(path), { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await walk(child));
    if (entry.isFile()) files.push(child);
  }

  return files;
}

function hasNoindex(html) {
  return [...html.matchAll(/<meta\b[^>]*>/gi)].some((match) => (
    /\bname=["']robots["']/i.test(match[0]) && /\bnoindex\b/i.test(match[0])
  ));
}

function hasDescription(html) {
  return [...html.matchAll(/<meta\b[^>]*>/gi)].some((match) => {
    if (!/\bname=["']description["']/i.test(match[0])) return false;
    const content = match[0].match(/\bcontent=(["'])(.*?)\1/i)?.[2] ?? '';
    return content.trim().length >= 40;
  });
}

async function validateOutput() {
  const outputFiles = await walk();
  const outputFileSet = new Set(outputFiles);
  const outputHtml = outputFiles.filter((path) => extname(path) === '.html');
  const expectedHtml = new Set([...indexablePages, ...supportPages]);
  const errors = [];

  for (const page of outputHtml) {
    if (!expectedHtml.has(page)) errors.push(`Unexpected HTML in artifact: ${page}`);
  }

  for (const page of expectedHtml) {
    if (!outputFileSet.has(page)) errors.push(`Missing expected page: ${page}`);
  }

  for (const page of indexablePages) {
    const html = await readFile(outputPath(page), 'utf8');
    const expectedCanonical = canonicalUrl(page);
    if (!html.includes(`rel="canonical" href="${expectedCanonical}"`)) {
      errors.push(`Missing self-canonical on ${page}: ${expectedCanonical}`);
    }
    if (!/<title>\s*[^<]+\s*<\/title>/i.test(html)) {
      errors.push(`Missing non-empty title on ${page}`);
    }
    if (!hasDescription(html)) {
      errors.push(`Missing useful meta description on ${page}`);
    }
    if (!/<h1\b[^>]*>[\s\S]*?<\/h1>/i.test(html)) {
      errors.push(`Missing H1 on ${page}`);
    }
    if (hasNoindex(html)) errors.push(`Indexable page is marked noindex: ${page}`);
  }

  for (const page of supportPages) {
    const html = await readFile(outputPath(page), 'utf8');
    if (!hasNoindex(html)) errors.push(`Support page is missing noindex: ${page}`);
  }

  const referencePattern = /\b(?:href|src|poster)=["']([^"']+)["']/gi;
  for (const page of outputHtml) {
    const html = await readFile(outputPath(page), 'utf8');
    for (const match of html.matchAll(referencePattern)) {
      const target = localTarget(match[1], page);
      if (target && !outputFileSet.has(target)) {
        errors.push(`Broken local reference in ${page}: ${match[1]} -> ${target}`);
      }
    }
  }

  if (errors.length) {
    throw new Error(`Production artifact validation failed:\n- ${errors.join('\n- ')}`);
  }

  console.log(`Built ${indexablePages.length} indexable pages and ${supportPages.length} noindex support pages.`);
  console.log(`Validated ${outputHtml.length} HTML files and ${outputFiles.length} total production files.`);
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const path of [...indexablePages, ...supportPages, ...rootAssets, ...individualAssets]) {
  await copy(path);
}

await copyTree('assets', { omitHtml: true });
await copyTree('members', { omitHtml: true });
await copyTree('products/assets', { omitHtml: true });
await copyTree('fdroid/repo', { omitHtml: true });

await writeFile(outputPath('.nojekyll'), '');
await writeFile(outputPath('sitemap.xml'), buildSitemap());

await validateOutput();
