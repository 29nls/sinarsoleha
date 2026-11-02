import type { Capability } from '~/utils/permissions'

declare module '#app' {
  interface PageMeta {
    capability?: Capability
  }
}

export {}
