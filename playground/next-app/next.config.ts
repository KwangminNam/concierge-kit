import type { NextConfig } from 'next';

const config: NextConfig = {
  // The e2e run reaches the app on a host that is not localhost, because browsers treat
  // localhost as a secure context and would store a Secure cookie over plain http, hiding
  // the very failure this package exists to prevent.
  allowedDevOrigins: ['dev.example.test'],
};

export default config;
