'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'genai-tests-'));
process.env.DSH_HOME = root;
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
