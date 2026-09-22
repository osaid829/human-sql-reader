// tests/test-runner.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runTests() {
  const testFiles = fs.readdirSync(__dirname)
    .filter(f => f.endsWith('.test.js'))
    .map(f => path.join(__dirname, f));

  let passed = 0;
  let failed = 0;

  for (const file of testFiles) {
    console.log(`\nRunning ${path.basename(file)}...`);
    try {
      const module = await import(file);
      if (module.default) {
        await module.default();
        passed++;
        console.log(`✅ ${path.basename(file)} passed`);
      }
    } catch (err) {
      failed++;
      console.error(`❌ ${path.basename(file)} failed:`, err);
    }
  }

  console.log(`\nTest Summary: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests();
