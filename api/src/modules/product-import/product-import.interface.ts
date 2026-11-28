import type { IAttributeSchemaQuery } from '../attribute-schema/index.ts'
import type { IStockLedger } from '../stock/index.ts'

/** An uploaded import file and what the uploader may fill in. */
export type ImportFile = { buffer: Buffer; fileName: string; canEditPrice: boolean; canAdjustStock: boolean }

/**
 * What the import needs from other modules: stock for opening stock (the only stock-changing path), and the attribute
 * schemas the template and rows follow.
 */
export type ProductImportPorts = {
  stock: Pick<IStockLedger, 'change'>
  schemas: Pick<IAttributeSchemaQuery, 'load'>
}
