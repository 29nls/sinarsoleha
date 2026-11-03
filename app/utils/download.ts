/**
 * Browser-only CSV download. Reports are exported without Supabase Storage,
 * per PRD §5.5: the file is built from data already on screen.
 */
export function downloadCsv(fileName: string, csv: string): void {
  if (typeof document === 'undefined') return

  // BOM keeps Excel on Windows reading the file as UTF-8.
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
