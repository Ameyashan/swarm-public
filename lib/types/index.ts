// Shared TypeScript types for Swarm.
// Domain models (issuers, facilities, covenants, etc.) will be added here as the schema lands.

export type ID = string

export interface Timestamps {
  created_at: string
  updated_at: string
}
