import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export type FrameworkId =
  | 'angular'
  | 'next'
  | 'nuxt'
  | 'remix'
  | 'sveltekit'
  | 'svelte'
  | 'astro'
  | 'solid'
  | 'react'
  | 'vue'
  | 'nestjs'
  | 'fastify'
  | 'koa'
  | 'express'
  | 'vite'
  | 'node'
  | 'unknown'

export type FrameworkInfo = {
  id: FrameworkId
  label: string
}

type PkgJson = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

function has(
  deps: Record<string, string>,
  name: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(deps, name)
}

/** Best-effort stack label from package.json (and light heuristics). */
export function detectFramework(projectPath: string): FrameworkInfo {
  const pkgPath = path.join(projectPath, 'package.json')
  if (!existsSync(pkgPath)) {
    return { id: 'unknown', label: 'Unknown' }
  }

  let pkg: PkgJson
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as PkgJson
  } catch {
    return { id: 'unknown', label: 'Unknown' }
  }

  const deps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
  }

  // Order matters: more specific stacks first
  if (has(deps, '@nestjs/core') || has(deps, '@nestjs/common')) {
    return { id: 'nestjs', label: 'NestJS' }
  }
  if (has(deps, '@angular/core')) {
    return { id: 'angular', label: 'Angular' }
  }
  if (has(deps, 'next')) {
    return { id: 'next', label: 'Next.js' }
  }
  if (has(deps, 'nuxt') || has(deps, 'nuxt3')) {
    return { id: 'nuxt', label: 'Nuxt' }
  }
  if (has(deps, '@remix-run/node') || has(deps, '@remix-run/react')) {
    return { id: 'remix', label: 'Remix' }
  }
  if (has(deps, '@sveltejs/kit')) {
    return { id: 'sveltekit', label: 'SvelteKit' }
  }
  if (has(deps, 'svelte')) {
    return { id: 'svelte', label: 'Svelte' }
  }
  if (has(deps, 'astro')) {
    return { id: 'astro', label: 'Astro' }
  }
  if (has(deps, 'solid-js')) {
    return { id: 'solid', label: 'Solid' }
  }
  if (has(deps, 'vue')) {
    return { id: 'vue', label: 'Vue' }
  }
  if (has(deps, 'react') || has(deps, 'react-dom')) {
    return { id: 'react', label: 'React' }
  }
  if (has(deps, 'fastify')) {
    return { id: 'fastify', label: 'Fastify' }
  }
  if (has(deps, 'koa')) {
    return { id: 'koa', label: 'Koa' }
  }
  if (has(deps, 'express')) {
    return { id: 'express', label: 'Express' }
  }
  if (has(deps, 'vite')) {
    return { id: 'vite', label: 'Vite' }
  }

  // Plain Node library / tool if it looks like a package
  if (
    Object.keys(pkg.dependencies ?? {}).length > 0 ||
    Object.keys(pkg.devDependencies ?? {}).length > 0
  ) {
    return { id: 'node', label: 'Node' }
  }

  return { id: 'unknown', label: 'Unknown' }
}
