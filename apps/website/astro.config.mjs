import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://tctcl.de',
  integrations: [
    starlight({
      title: 'Cake',
      description: 'Cake is a self-hosted agent harness built on Pi, with a web interface, isolated workspaces, and agent profiles.',
      logo: {
        src: './src/assets/cake.svg',
        alt: 'Cake',
      },
      favicon: '/favicon.svg',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/Tctcl/cake-harness',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/Tctcl/cake-harness/edit/main/apps/website/src/content/docs/',
      },
      customCss: ['/src/styles/docs.css'],
      disable404Route: true,
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Overview', slug: 'docs' },
            { label: 'Requirements', slug: 'docs/requirements' },
            { label: 'Install', slug: 'docs/install' },
            { label: 'First steps', slug: 'docs/first-steps' },
          ],
        },
        {
          label: 'Using Cake',
          items: [
            { label: 'Workspaces', slug: 'docs/workspaces' },
            { label: 'Agents', slug: 'docs/agents' },
            { label: 'Chat', slug: 'docs/chat' },
            { label: 'Tools', slug: 'docs/tools' },
          ],
        },
        {
          label: 'Operate',
          items: [
            { label: 'Configuration', slug: 'docs/configuration' },
            { label: 'Accounts and security', slug: 'docs/accounts-and-security' },
            { label: 'Upgrading', slug: 'docs/upgrading' },
            { label: 'Troubleshooting', slug: 'docs/troubleshooting' },
          ],
        },
        {
          label: 'Reference',
          items: [{ label: 'Architecture', slug: 'docs/architecture' }],
        },
      ],
    }),
  ],
})
