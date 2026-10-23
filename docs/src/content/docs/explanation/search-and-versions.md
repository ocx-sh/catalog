---
title: "Search and versions"
sidebar:
  order: 4
---
<!-- doc_type: explanation -->

Two parts of the rendered site follow rules that are not obvious from the
page: how search orders packages, and how a package's version tree treats
pre-release and ephemeral tags.

## How search ranks

The grid's search box and the Mod+K palette rank packages by relevance.
They do not just filter. The model is a port of the one grim uses, so a query
orders packages the same way in both tools.

- **Fields count unequally.** A match in the package name is worth three
  times a description match. Keywords count twice. Description and namespace
  count once.
- **Every word must match.** A query of two words keeps only packages where
  each word hits some field.
- **Names and keywords match loosely, prose matches by word.** A typo or a
  skipped letter still finds a name or keyword, as long as the hit is tight.
  A description or namespace matches only on a whole word or the start of one,
  so `go` does not match every sentence that happens to hold a `g` and an `o`.
- **An exact name wins.** A package named like your query, or holding it as a
  whole word (`grim` in `grim-usage`), ranks above looser hits.
- **Weak hits are dropped.** A result scoring under half of the best one is
  not shown. The cut applies after your platform and keyword filters, so
  filtering never hides the best match.

Ties keep the sort you chose. The docs group of the palette is separate: it
matches a page's title, headings and excerpt (see
[known limitations](../../ops/known-limitations/#the-palette-searches-page-titles-headings-and-an-excerpt)).

## The version tree on a detail page

The Versions card shows one row per variant, with the tags that share the
newest digest chained together (`latest`, `1`, `1.9`, `1.9.13`). Below it, a
breakdown groups tags into major and minor lines.

**Pre-release tracks.** A tag that is a semver pre-release (`2.0.0-rc.1`), or
a name carrying a build stamp (`nightly_20261020T101500Z`), belongs to a
*track*. The track is the tag without its stamp. Tracks sit in their own
list so release candidates do not push stable versions out of view.

**Ephemeral tags.** The index marks a tag `ephemeral` when it is a snapshot
the index may prune. The detail page draws it with a bar, and the support
matrix notes it as "ephemeral: may be pruned". An ephemeral tag is never
`latest`: `catalog.json` skips it when it picks the newest stable version, so
the catalog never advertises a build that may disappear.

**Long trees load on demand.** The page ships the newest lines and their newest
patches. Opening a collapsed group loads the rest from the package's
`_root.json`. The support-matrix dialog opens at once with a placeholder, then
fills with every tag, newest first, once its rows arrive. They load on the first
open only, so a package with hundreds of tags does not make the page heavier.
