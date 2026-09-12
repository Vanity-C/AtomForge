import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'public/preview-vendor');
mkdirSync(dest, {recursive: true});
for (const [source, name] of [
  ['react/umd/react.production.min.js', 'react.js'],
  ['react-dom/umd/react-dom.production.min.js', 'react-dom.js'],
  ['@babel/standalone/babel.min.js', 'babel.js'],
]) copyFileSync(path.join(root, 'node_modules', source), path.join(dest, name));
