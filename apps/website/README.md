# Cake website

The marketing page and operator documentation for [Cake](https://github.com/Tctcl/cake-harness), built with Astro and Starlight. The custom landing page is `/`; Starlight renders the documentation beneath `/docs`. The production site URL is `https://tctcl.de`.

This package builds to static files and is deployed independently of Cake's product Compose stack and GHCR images.

## Local development

From the repository root, with Node `26.13.1` and pnpm `12.16.1`:

```bash
pnpm install
pnpm --filter website dev
```

Astro prints the local URL. Do not use the persistent development server as a verification gate. Instead run:

```bash
pnpm --filter website typecheck
pnpm --filter website lint
pnpm --filter website test
pnpm --filter website build
```

The build writes `apps/website/dist`. Tests verify that every Markdown/MDX documentation page has frontmatter with a non-empty title. oxlint checks the JavaScript and TypeScript sources; Astro's own checker covers `.astro` files because oxlint does not parse them.

## Container build

The Dockerfile expects the **repository root** as its build context so the workspace manifests, lockfile, and shared packages are available:

```bash
docker build -f apps/website/Dockerfile -t cake-website .
```

The first stage uses the repository's pinned Node and pnpm versions. The final stage is unprivileged nginx, serves `dist` on port `8080`, gzips text assets, gives Astro's fingerprinted `/_astro/` files immutable cache headers, revalidates HTML, and serves the custom `404.html`.

`apps/website/Dockerfile.dockerignore` intentionally overrides the root `.dockerignore`: the product build excludes `apps/website`, while this separate build must include it.

## Deploy on Coolify

Create a new application from the Cake repository and use these settings:

| Setting | Value |
| --- | --- |
| Build pack | **Dockerfile** |
| Base directory | `/` |
| Dockerfile location | `apps/website/Dockerfile` |
| Build context | Repository root (the base directory `/`) |
| Branch | `main` |
| Port | `8080` |
| Domain / FQDN | `https://tctcl.de` |
| Auto-deploy | Enabled for pushes to `main` |

There is no runtime environment variable, database, or product service dependency. Coolify should route HTTPS to the container's port `8080`.

Optionally set the deployment watch path to:

```text
apps/website/**
```

That prevents product-only changes from redeploying the website. If the watch path is enabled, manually redeploy after changes to the root lockfile/workspace configuration or shared packages that should change the website build; those files fall outside `apps/website/**`.

Do not add this website to the root product `Dockerfile`, `deploy/compose.yaml`, or `.github/workflows/images.yml`. Those publish and operate only the Cake product.
