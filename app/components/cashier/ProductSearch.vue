<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue'
import type { ScanBuffer } from '~/adapters/scanner'

const props = defineProps<{
  /** Null when the barcode scanner plugin is off; typing still works. */
  scanBuffer?: ScanBuffer | null
  scannerEnabled?: boolean
}>()

const model = defineModel<string>({ required: true })
const emit = defineEmits<{
  navigate: [delta: number]
  choose: []
  escape: []
  scan: [code: string]
}>()

const inputRef = useTemplateRef<HTMLInputElement>('input')

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  return (
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.tagName === 'SELECT' ||
    element.isContentEditable
  )
}

/** Space and Enter must keep activating a focused button or link. */
function isInteractiveTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  return Boolean(element.closest('button, a, summary, [role="button"], [role="tab"]'))
}

/**
 * A keyboard-wedge scanner fires faster than a person can type, so a scan is
 * only recognised outside a text field. Inside the search field the existing
 * Enter handler already adds the highlighted result.
 */
function onWindowKeydown(event: KeyboardEvent) {
  if (!props.scannerEnabled || !props.scanBuffer) return
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
  if (isTypingTarget(event.target) || isInteractiveTarget(event.target)) return
  if (event.key === ' ') return
  if (event.key.length === 1) event.preventDefault()
  const code = props.scanBuffer.push(event.key)
  if (!code) return
  emit('scan', code)
}

onMounted(() => window.addEventListener('keydown', onWindowKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKeydown))

function focus() {
  inputRef.value?.focus()
  inputRef.value?.select()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    emit('navigate', 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    emit('navigate', -1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    emit('choose')
  } else if (event.key === 'Escape') {
    event.preventDefault()
    emit('escape')
  }
}

defineExpose({ focus })
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <label class="sr-only" for="cashier-search">Cari SKU atau nama produk</label>
    <input
      id="cashier-search"
      ref="input"
      v-model="model"
      class="field w-full sm:max-w-md"
      type="search"
      autocomplete="off"
      placeholder="Scan / ketik SKU atau nama produk…"
      @keydown="onKeydown"
    />
    <span v-if="scannerEnabled" class="tag tag-accent">Scanner</span>
    <span class="tag">F2</span>
  </div>
</template>
