# OCX Catalog

`@ocx-sh/catalog` renders one or more **OCX package indices** into a browsable
static site: a package grid, per-package detail pages with README, platforms,
versions and install commands, client-side search, and an optional docs section.

It is a *renderer*, not a producer. Point it at an index — a local directory, an
HTTPS endpoint, or a git repository — and it builds a site around what is
already there. It never writes to an index and never invents index data. See
[Index vs. catalog](explanation/index-vs-catalog.md) for where that line sits.

!!! warning "Read this before you pick a host"
    A generated catalog site only works when it is served from a **domain
    root**, and the security headers it emits are honoured by Cloudflare Pages
    and Netlify only. Both facts are load-bearing for GitHub Pages and GitLab
    Pages deployments — see [Known limitations](ops/known-limitations.md) and
    [Hosting and headers](ops/hosting-and-headers.md).

## Start from what you are trying to do

<div class="grid cards" markdown>

-   :material-github: **"I run an index on GitHub and want a browsable catalog site."**

    ---

    Render the CI workflow, build the site, deploy it to GitHub Pages — and
    the two things that will silently break if you use the default project
    Pages URL.

    [:octicons-arrow-right-24: Deploy on GitHub Pages](how-to/deploy-on-github-pages.md)

-   :material-gitlab: **"I run an index on GitLab and want a browsable catalog site."**

    ---

    The rendered job file, the `include:` line your root `.gitlab-ci.yml`
    needs, and a `pages` job that publishes the build.

    [:octicons-arrow-right-24: Deploy on GitLab Pages](how-to/deploy-on-gitlab-pages.md)

-   :material-earth: **"I want my catalog to also show the public `index.ocx.sh` packages."**

    ---

    Aggregate the official index alongside your own as a second, non-root
    source — and what merging does to precedence and detail pages.

    [:octicons-arrow-right-24: Aggregate the public index](how-to/configure-sources.md#aggregate-the-public-index)

-   :material-server-security: **"I want to self-host my own index — corporate mirror or air-gapped."**

    ---

    A `path` or `git` source as your only source, with no dependency on
    `index.ocx.sh` and no build-time egress to it.

    [:octicons-arrow-right-24: Self-host your own index](how-to/configure-sources.md#self-host-your-own-index)

-   :material-play-circle: **"I just want to see it running before committing to anything."**

    ---

    One command against a directory of index JSON, no config file, no deploy.

    [:octicons-arrow-right-24: Preview locally](how-to/preview-locally-with-dev.md)

</div>

## Install

```sh
npm install --save-dev @ocx-sh/catalog vitepress vue
```

Node.js `>=20.19`. `vitepress` and `vue` are peer dependencies — this package
plugs a theme into your own VitePress install rather than bundling one. Then
work through the [Quickstart](how-to/quickstart.md).

## The rest of the documentation

| Section | What is in it |
|---|---|
| [How-To](how-to/index.md) | Task-shaped guides: quickstart, sources, deploys, local preview, branding |
| [Reference](reference/index.md) | Exhaustive: CLI flags and exit codes, config schema, CI rendering, output layout |
| [Explanation](explanation/index.md) | Why the design is the way it is: ownership, multi-source, security model |
| [Ops](ops/index.md) | Limitations, host selection, troubleshooting |
