import semver from 'semver'
import type { FrameworkId, FrameworkInfo } from './framework.ts'
import type { MigrationGuide, PackageFinding } from './types.ts'

type GuideDef = {
  /** Packages whose current/latest majors decide whether to show the guide */
  markerPackages: string[]
  title: string
  url: (fromMajor: number, toMajor: number) => string
}

const GUIDES: Partial<Record<FrameworkId, GuideDef>> = {
  angular: {
    markerPackages: ['@angular/framework', '@angular/core'],
    title: 'Angular Update Guide',
    url: (from, to) =>
      `https://angular.dev/update-guide?v=${from}.0-${to}.0`,
  },
  next: {
    markerPackages: ['next'],
    title: 'Next.js upgrade docs',
    url: () =>
      'https://nextjs.org/docs/app/building-your-application/upgrading',
  },
  nuxt: {
    markerPackages: ['nuxt'],
    title: 'Nuxt upgrade docs',
    url: () => 'https://nuxt.com/docs/getting-started/upgrade',
  },
  nestjs: {
    markerPackages: ['@nestjs/core'],
    title: 'NestJS migration guide',
    url: () => 'https://docs.nestjs.com/migration-guide',
  },
  vue: {
    markerPackages: ['vue'],
    title: 'Vue migration guide',
    url: () => 'https://v3-migration.vuejs.org/',
  },
  sveltekit: {
    markerPackages: ['@sveltejs/kit'],
    title: 'SvelteKit docs',
    url: () => 'https://svelte.dev/docs/kit/migrating',
  },
  remix: {
    markerPackages: ['@remix-run/react', '@remix-run/node'],
    title: 'Remix docs',
    url: () => 'https://remix.run/docs/en/main/start/changelog',
  },
  astro: {
    markerPackages: ['astro'],
    title: 'Astro upgrade guide',
    url: () => 'https://docs.astro.build/en/guides/upgrade-to/v5/',
  },
}

function majorsFromRaw(raw: string | null | undefined): number[] {
  if (!raw || raw.includes('versions')) return []
  const parts = raw.split(/[–—,/\s]+/).map((s) => s.trim()).filter(Boolean)
  const majors: number[] = []
  for (const part of parts) {
    const coerced = semver.coerce(part)
    if (coerced) majors.push(semver.major(coerced))
  }
  return majors
}

function pickMarkerFinding(
  findings: PackageFinding[],
  markers: string[],
): PackageFinding | null {
  for (const name of markers) {
    const hit = findings.find((f) => f.name === name && !f.ignored)
    if (hit) return hit
  }
  return null
}

/**
 * Official upgrade/migration guide when the framework's latest major
 * is ahead of what the project currently runs. Returns null otherwise.
 */
export function resolveMigrationGuide(
  framework: FrameworkInfo,
  findings: PackageFinding[],
): MigrationGuide | null {
  const def = GUIDES[framework.id]
  if (!def) return null

  const finding = pickMarkerFinding(findings, def.markerPackages)
  if (!finding) return null

  const currentMajors = majorsFromRaw(finding.current)
  const latestMajors = majorsFromRaw(finding.latest)
  if (currentMajors.length === 0 || latestMajors.length === 0) return null

  const fromMajor = Math.min(...currentMajors)
  const toMajor = Math.max(...latestMajors)
  if (toMajor <= fromMajor) return null

  return {
    frameworkId: framework.id,
    frameworkLabel: framework.label,
    title: def.title,
    url: def.url(fromMajor, toMajor),
    fromMajor,
    toMajor,
    markerPackage: finding.name,
  }
}
