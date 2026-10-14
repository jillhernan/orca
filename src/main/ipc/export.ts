import { BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { ExportTimeoutError, htmlToPdf } from '../lib/html-to-pdf'

export type ExportHtmlToPdfArgs = {
  html: string
  title: string
}

export type ExportHtmlToPdfResult =
  | { success: true; filePath: string }
  | { success: false; cancelled?: boolean; error?: string }

export type ExportSaveTextFileArgs = {
  content: string
  defaultName: string
  extension: string
  filterName: string
}

function sanitizeFileStem(name: string): string {
  // Why: Windows forbids /\:*?"<>| in filenames; a bounded stem keeps the save dialog stable.
  return name.replace(/[/\\:*?"<>|]/g, '_').slice(0, 100) || 'export'
}

export function registerExportHandlers(): void {
  ipcMain.removeHandler('export:save-text-file')
  ipcMain.handle(
    'export:save-text-file',
    async (event, args: ExportSaveTextFileArgs): Promise<ExportHtmlToPdfResult> => {
      const extension = args.extension.replace(/[^a-z0-9.]/gi, '').slice(0, 24) || 'txt'
      const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
      const dialogOptions = {
        defaultPath: `${sanitizeFileStem(args.defaultName)}.${extension}`,
        filters: [
          {
            name: args.filterName.slice(0, 60) || extension,
            extensions: [extension.split('.').pop() ?? extension]
          }
        ]
      }
      try {
        const { canceled, filePath } = parent
          ? await dialog.showSaveDialog(parent, dialogOptions)
          : await dialog.showSaveDialog(dialogOptions)
        if (canceled || !filePath) {
          return { success: false, cancelled: true }
        }
        await writeFile(filePath, args.content, 'utf8')
        return { success: true, filePath }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save file'
        }
      }
    }
  )
  ipcMain.removeHandler('export:html-to-pdf')
  ipcMain.handle(
    'export:html-to-pdf',
    async (event, args: ExportHtmlToPdfArgs): Promise<ExportHtmlToPdfResult> => {
      const { html, title } = args
      if (!html.trim()) {
        return { success: false, error: 'No content to export' }
      }

      try {
        const pdfBuffer = await htmlToPdf(html)

        const defaultFilename = `${sanitizeFileStem(title)}.pdf`

        const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
        const dialogOptions = {
          defaultPath: defaultFilename,
          filters: [{ name: 'PDF', extensions: ['pdf'] }]
        }
        const { canceled, filePath } = parent
          ? await dialog.showSaveDialog(parent, dialogOptions)
          : await dialog.showSaveDialog(dialogOptions)

        if (canceled || !filePath) {
          return { success: false, cancelled: true }
        }

        await writeFile(filePath, pdfBuffer)
        return { success: true, filePath }
      } catch (error) {
        if (error instanceof ExportTimeoutError) {
          return { success: false, error: 'Export timed out' }
        }
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to export PDF'
        }
      }
    }
  )
}
