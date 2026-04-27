#!/usr/bin/env node
// Usage: node scripts/encodeKey.js <your-new-api-key>
//
// Outputs the two encoded arrays to paste into src/utils/apiSigner.js.
// The encoding uses position-dependent XOR: mask[i] = (i * 7 + 42) % 256

const key = process.argv[2];
if (!key) {
  console.error('Usage: node scripts/encodeKey.js <api-key>');
  process.exit(1);
}

const encoded = [...key].map((c, i) => c.charCodeAt(0) ^ ((i * 7 + 42) % 256));
const half    = Math.ceil(encoded.length / 2);
const kA      = encoded.slice(0, half);
const kB      = encoded.slice(half);

// Verify round-trip
const decoded = encoded.map((b, i) => String.fromCharCode(b ^ ((i * 7 + 42) % 256))).join('');
if (decoded !== key) {
  console.error('Round-trip verification FAILED — do not use these values.');
  process.exit(1);
}

console.log('\nPaste into src/utils/apiSigner.js:\n');
console.log(`const _KA = [${kA.join(',')}];`);
console.log(`const _KB = [${kB.join(',')}];`);
console.log('\n✓ Round-trip verified.');
