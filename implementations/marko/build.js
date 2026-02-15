#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Must call before requiring .marko files
require('marko/node-require');

const distDir = path.join(__dirname, 'dist');
const dataDir = path.join(__dirname, '..', '..', 'data');
const cssDir = path.join(__dirname, '..', '..', 'css');
const assetsDir = path.join(__dirname, '..', '..', 'assets');

// Create dist directories
fs.mkdirSync(path.join(distDir, 'css'), { recursive: true });
fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });

// Copy CSS files
['tokens.css', 'base.css', 'layout.css', 'components.css', 'effects.css'].forEach(f => {
  fs.copyFileSync(path.join(cssDir, f), path.join(distDir, 'css', f));
});

// Copy assets
['avatar.svg', 'favicon.svg'].forEach(f => {
  const src = path.join(assetsDir, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(distDir, 'assets', f));
  }
});

// Read JSON data
const profile = JSON.parse(fs.readFileSync(path.join(dataDir, 'profile.json'), 'utf-8'));
const health = JSON.parse(fs.readFileSync(path.join(dataDir, 'health.json'), 'utf-8'));
const github = JSON.parse(fs.readFileSync(path.join(dataDir, 'github.json'), 'utf-8'));
const reading = JSON.parse(fs.readFileSync(path.join(dataDir, 'reading.json'), 'utf-8'));
const books = JSON.parse(fs.readFileSync(path.join(dataDir, 'books.json'), 'utf-8'));
const system = JSON.parse(fs.readFileSync(path.join(dataDir, 'system.json'), 'utf-8'));

// Render template
const templateModule = require('./src/index.marko');
const template = templateModule.default || templateModule;
const html = template.renderToString({ profile, health, github, reading, books, system });

// Write output
fs.writeFileSync(path.join(distDir, 'index.html'), html);
console.log('Built dist/index.html');
