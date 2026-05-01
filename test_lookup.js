/**
 * Quick test: try sample numbers from different states
 */
const { getStateFromPhone } = require('./05_lookup_service');

const testNumbers = [
  '9826123456',  // Madhya Pradesh - Airtel
  '+91 9876543210', // with +91 and space
  '09893123456', // with leading 0
  '7000123456',  // Jio
  '6202123456',  // Bihar - Jio
  '9821000000',  // Mumbai/Maharashtra
  '9810000000',  // Delhi
  '5555555555',  // invalid (starts with 5)
  '1234',        // too short
];

console.log('🧪 Phone → State Lookup Test\n');
console.log('Phone Input            → Phone (clean)  | State                | Operator        | Conf | Source');
console.log('─'.repeat(120));

for (const num of testNumbers) {
  const result = getStateFromPhone(num);
  if (result.error) {
    console.log(`${num.padEnd(22)} → ❌ ${result.error}`);
    continue;
  }
  const phone = (result.phone || '').padEnd(15);
  const state = (result.state || '—').padEnd(20);
  const op = (result.operator || '—').padEnd(15);
  const conf = result.confidence != null ? result.confidence.toFixed(2) : '—';
  const src = result.source || '—';
  console.log(`${num.padEnd(22)} → ${phone} | ${state} | ${op} | ${conf} | ${src}`);
}
