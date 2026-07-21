import path from 'node:path';

const root = process.cwd();

export const config = {
  port: Number(process.env.PORT || 4100),
  apiKey: process.env.STRATUS_API_KEY || 'sk_stratus_dev_change_me',
  maxConcurrentSessions: Number(process.env.MAX_CONCURRENT_SESSIONS || 100),
  browserHourAllowance: Number(process.env.BROWSER_HOUR_ALLOWANCE || 500),
  chromePath:
    process.env.CHROME_EXECUTABLE_PATH ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 4100}`,
  dataDir: process.env.STRATUS_DATA_DIR || path.join(root, '.stratus'),
  testMode: process.env.NODE_ENV === 'test'
};

export const regions = ['us-west-2', 'us-east-1', 'eu-central-1', 'ap-southeast-1'];
