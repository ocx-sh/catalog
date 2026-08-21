import type { ManifestDescriptor, Platform } from '../composables/useImageIndex'

/**
 * Filters an OCI image index's `manifests[]` down to descriptors that name a
 * real, displayable platform. Mirrors the identical filter the index bot's
 * `_catalog_platforms` and ocx's `Index::fetch_candidates` apply for the
 * same reason: a descriptor with no `platform` at all, or with
 * `platform: {"os":"unknown","architecture":"unknown"}`, is an attestation
 * (SBOM, signature, provenance) riding in the same index — never a real
 * platform build. The projection the wire format used to carry silently
 * dropped these upstream; verbatim image-index bytes do not, so this
 * component-facing filter is the one place left that must.
 *
 * Extracted as a pure function (not inlined in `PlatformMatrix.vue`) so it's
 * unit-testable directly, the same reasoning `version.ts`'s
 * `rowHasHiddenYanked` docblock gives for staying out of its component.
 */
export function visiblePlatforms(manifests: ManifestDescriptor[]): (ManifestDescriptor & { platform: Platform })[] {
  // ponytail: the registry-served `o/` object is publisher-controlled, not
  // bot-validated (that's D4(c)'s cli/validate.py gate, a different work
  // package, not yet landed) — guard the one shape assumption this
  // component-facing filter makes so a malformed `manifests` degrades to
  // the empty-state UI instead of throwing inside a Vue computed.
  if (!Array.isArray(manifests)) return []
  return manifests.filter(
    (m): m is ManifestDescriptor & { platform: Platform } =>
      !!m.platform && !(m.platform.os === 'unknown' && m.platform.architecture === 'unknown'),
  )
}
