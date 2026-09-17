import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Mr. Secret',
    description: 'Blurs secrets & PII on any page using TypeSafe AI Jev',
    permissions: ['storage', 'activeTab', 'tabs'],
    host_permissions: ['https://api.typesafe.ai/*', '<all_urls>'],
  },
});
