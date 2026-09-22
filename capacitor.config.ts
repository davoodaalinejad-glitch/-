import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.davood.portfoliotracker',
  appName: 'پورتفوی من',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
};

export default config;
