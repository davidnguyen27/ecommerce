// Port to code not moved into modules yet: typed by the current function, wired in product-import.module.ts.
import type { changeStock } from '../../stock/stock.ts'

/** An uploaded import file and what the uploader may fill in. */
export type ImportFile = { buffer: Buffer; fileName: string; canEditPrice: boolean; canAdjustStock: boolean }

/** What the import needs from stock (opening stock goes through the only stock-changing path). */
export type ProductImportPorts = { stock: { change: typeof changeStock } }
