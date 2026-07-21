#!/usr/bin/env node
import { Stratus } from '../packages/sdk/index.js';

const [command, ...args] = process.argv.slice(2);
const apiKey = process.env.STRATUS_API_KEY || 'sk_stratus_dev_change_me';
const baseUrl = process.env.STRATUS_BASE_URL || 'http://localhost:4100';
const client = new Stratus({ apiKey, baseUrl });

try {
  let result;
  if (command === 'doctor') result = await fetch(`${baseUrl}/health`).then((response) => response.json());
  else if (command === 'usage') result = await client.usage();
  else if (command === 'sessions') result = await client.sessions.list();
  else if (command === 'launch') result = await client.sessions.create({ region: args[0] || 'us-west-2', keepAlive: true });
  else if (command === 'release') result = await client.sessions.release(args[0]);
  else {
    console.log('Usage: stratus <doctor|usage|sessions|launch [region]|release <session-id>>');
    process.exit(command ? 1 : 0);
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`${error.code || 'ERROR'}: ${error.message}`);
  process.exit(1);
}
