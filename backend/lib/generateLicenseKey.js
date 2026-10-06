import crypto from 'crypto';

export function generateLicenseKey() {
  const segment = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `VIBEY-${segment()}-${segment()}-${segment()}-${segment()}`;
}
