import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const exportApi = {
  htmlToPdf: (args: {
    html: string
    title: string
  }): Promise<
    { success: true; filePath: string } | { success: false; cancelled?: boolean; error?: string }
  > => ipcRenderer.invoke('export:html-to-pdf', args),
  saveTextFile: (args: {
    content: string
    defaultName: string
    extension: string
    filterName: string
  }): Promise<
    { success: true; filePath: string } | { success: false; cancelled?: boolean; error?: string }
  > => ipcRenderer.invoke('export:save-text-file', args)
} satisfies PreloadApi['export']
