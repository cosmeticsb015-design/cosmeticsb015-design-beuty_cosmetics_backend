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


function findStrapiAdminPackage() {
  const candidates = [
    path.join(projectRoot, 'node_modules', '.pnpm'),
  ];

  for (const pnpmRoot of candidates) {
    if (!fs.existsSync(pnpmRoot)) {
      continue;
    }

    const stack = [pnpmRoot];
    while (stack.length > 0) {
      const current = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const entryPath = path.join(current, entry.name);
        if (!entry.isDirectory()) {
          continue;
        }

        const adminPackage = path.join(entryPath, 'node_modules', '@strapi', 'admin');
        const sessionAuth = path.join(adminPackage, 'dist', 'server', 'shared', 'utils', 'session-auth.js');
        if (fs.existsSync(sessionAuth)) {
          return adminPackage;
        }

        if (entry.name === 'node_modules') {
          continue;
        }
        stack.push(entryPath);
      }
    }
  }

  return null;
}

function ensureStrapiAdminPnpmCompatLink() {
  const strapiScope = path.join(projectRoot, 'node_modules', '@strapi');
  const adminLink = path.join(strapiScope, 'admin');
  const expectedSessionAuth = path.join(adminLink, 'dist', 'server', 'shared', 'utils', 'session-auth.js');

  if (fs.existsSync(expectedSessionAuth)) {
    return;
  }

  const adminPackage = findStrapiAdminPackage();
  if (!adminPackage) {
    console.warn('[admin-2fa] Could not locate @strapi/admin session-auth helper under node_modules/.pnpm.');
    return;
  }

  fs.mkdirSync(strapiScope, { recursive: true });

  if (fs.existsSync(adminLink)) {
    console.warn(`[admin-2fa] ${path.relative(projectRoot, adminLink)} exists but session-auth.js was not found; leaving it untouched.`);
    return;
  }

  fs.symlinkSync(adminPackage, adminLink, 'junction');
  console.log(`[admin-2fa] Linked ${path.relative(projectRoot, adminLink)} for pnpm compatibility.`);
}

const files = [
  ['services/auth.js', 'services/auth.js'],
  ['services/auth.mjs', 'services/auth.mjs'],
  ['pages/Auth/components/Login.js', 'pages/Auth/components/Login.js'],
  ['pages/Auth/components/Login.mjs', 'pages/Auth/components/Login.mjs'],
];

ensureStrapiAdminPnpmCompatLink();

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
