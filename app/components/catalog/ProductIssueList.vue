<script setup lang="ts">
import type { ProductIssue } from '~/types/catalog'
import { issueLabel } from '~/utils/catalog'

defineProps<{ issues: ProductIssue[] }>()
</script>

<template>
  <span v-if="issues.length === 0" class="text-[var(--color-muted)]">—</span>
  <div v-else class="flex max-w-[260px] flex-wrap gap-1">
    <span
      v-for="issue in issues"
      :key="`${issue.code}-${issue.detail ?? ''}`"
      class="tag tag-warn"
      :title="issue.detail ?? issueLabel(issue.code)"
    >
      {{ issueLabel(issue.code, issue.detail) }}
    </span>
  </div>
</template>
