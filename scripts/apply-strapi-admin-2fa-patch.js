#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const patchRoot = path.join(
  projectRoot,
  'node_modules',
  '@vivinkv28',
  'strapi-2fa-admin-plugin',
  'host-patch',
  'strapi-admin-2fa-patch'
);
const adminRoot = path.join(projectRoot, 'src', 'admin');

const files = [
  ['services/auth.js', 'services/auth.js'],
  ['services/auth.mjs', 'services/auth.mjs'],
  ['pages/Auth/components/Login.js', 'pages/Auth/components/Login.js'],
  ['pages/Auth/components/Login.mjs', 'pages/Auth/components/Login.mjs'],
];

if (!fs.existsSync(patchRoot)) {
  console.warn(
    '[admin-2fa] Host patch not found. Install @vivinkv28/strapi-2fa-admin-plugin before building/developing the admin panel.'
  );
  process.exit(0);
}

for (const [source, target] of files) {
  const sourcePath = path.join(patchRoot, source);
  const targetPath = path.join(adminRoot, target);

  if (!fs.existsSync(sourcePath)) {
    console.warn(`[admin-2fa] Skipping missing patch file: ${source}`);
    continue;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  console.log(`[admin-2fa] Patched ${path.relative(projectRoot, targetPath)}`);
}
