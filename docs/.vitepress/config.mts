import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'mcp-pipe',
  description: 'Copy/paste for AI tool calls — a self-hosted MCP proxy with handles, refs, patch-and-rerun, jq, plans and recipes.',
  base: '/mcp-pipe/',
  cleanUrls: true,
  srcExclude: ['TRYING-IT.md'],
  markdown: {
    // The docs are full of literal {{ … }} refs; stop Vue from interpolating them in inline code.
    config(md) {
      const inline = md.renderer.rules.code_inline!;
      md.renderer.rules.code_inline = (tokens, idx, opts, env, self) =>
        inline(tokens, idx, opts, env, self).replace(/^<code/, '<code v-pre');
    },
  },
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/install' },
      { text: 'Reference', link: '/reference/ops' },
      { text: 'Security', link: '/security' },
      { text: 'GitHub', link: 'https://github.com/cann1neof/mcp-pipe' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Install', link: '/guide/install' },
          { text: 'Handles, get and patch', link: '/guide/handles' },
          { text: 'Refs and jq', link: '/guide/refs' },
          { text: 'Map', link: '/guide/map' },
          { text: 'Peek', link: '/guide/peek' },
          { text: 'Plans (chains)', link: '/guide/chains' },
          { text: 'AI steps', link: '/guide/ai-steps' },
          { text: 'Recipes', link: '/guide/recipes' },
          { text: 'Blind mode', link: '/guide/blind-mode' },
          { text: 'Configuration', link: '/guide/config' },
        ],
      },
      { text: 'Reference', items: [{ text: 'pipe__* tools', link: '/reference/ops' }] },
      { text: 'More', items: [{ text: 'Security', link: '/security' }, { text: 'Benchmarks', link: '/benchmarks' }] },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/cann1neof/mcp-pipe' }],
    search: { provider: 'local' },
  },
});
