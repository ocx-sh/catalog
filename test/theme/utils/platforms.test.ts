import { describe, expect, test } from 'vitest'
import type { ManifestDescriptor } from '../../../src/theme/composables/useImageIndex.js'
import { visiblePlatforms } from '../../../src/theme/utils/platforms.js'

// No `bot/tests/golden/dispatch/expected_platforms.json` fixture exists yet
// on this branch (B6 has no dependency on the bot's work package and can
// merge before it — plan_oci_align_index_site.md §5). Hand-written vectors
// here instead; once the shared fixture lands, point this suite at it so
// the three-implementation filter parity (bot, ocx, site) has one answer
// all three are asserted against.

describe('visiblePlatforms', () => {
  test('keeps descriptors that carry a real platform', () => {
    const manifests: ManifestDescriptor[] = [
      { mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: 'sha256:aaa', size: 512, platform: { architecture: 'amd64', os: 'linux' } },
      { mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: 'sha256:bbb', size: 512, platform: { architecture: 'arm64', os: 'linux' } },
    ]
    expect(visiblePlatforms(manifests).map(m => m.digest)).toEqual(['sha256:aaa', 'sha256:bbb'])
  })

  test('drops a descriptor with no platform key (attestation/SBOM/signature)', () => {
    const manifests: ManifestDescriptor[] = [
      { mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: 'sha256:aaa', size: 512, platform: { architecture: 'amd64', os: 'linux' } },
      { mediaType: 'application/vnd.in-toto+json', digest: 'sha256:ccc', size: 128 },
    ]
    expect(visiblePlatforms(manifests).map(m => m.digest)).toEqual(['sha256:aaa'])
  })

  test('drops an unknown/unknown descriptor (buildx attestation manifest)', () => {
    const manifests: ManifestDescriptor[] = [
      { mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: 'sha256:aaa', size: 512, platform: { architecture: 'amd64', os: 'linux' } },
      { mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: 'sha256:ddd', size: 256, platform: { architecture: 'unknown', os: 'unknown' } },
    ]
    expect(visiblePlatforms(manifests).map(m => m.digest)).toEqual(['sha256:aaa'])
  })

  test('an index with only attestation descriptors renders zero platforms', () => {
    const manifests: ManifestDescriptor[] = [
      { mediaType: 'application/vnd.in-toto+json', digest: 'sha256:ccc', size: 128 },
      { mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: 'sha256:ddd', size: 256, platform: { architecture: 'unknown', os: 'unknown' } },
    ]
    expect(visiblePlatforms(manifests)).toEqual([])
  })

  test('a malformed manifests value (non-array) degrades to empty instead of throwing', () => {
    // `o/` bytes are publisher-controlled, not bot-validated — see the
    // guard's own comment. `as unknown as` because the malformed shape is
    // exactly what the type system says can't happen.
    expect(visiblePlatforms({ not: 'an array' } as unknown as ManifestDescriptor[])).toEqual([])
  })
})
