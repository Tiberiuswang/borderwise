// Public frontend configuration only. Never put Zhipu (智谱) API keys or other provider secrets here.
// Set url to your deployed Worker origin. For one-click AI access, set publicAccess
// to true and configure PUBLIC_ACCESS = "true" in worker/wrangler.toml.
export const AI_CONFIG = Object.freeze({
  // Example after deploying: 'https://borderwise-ai-proxy.<your-subdomain>.workers.dev'
  enabled: false,
  publicAccess: false,
  url: '',
});
