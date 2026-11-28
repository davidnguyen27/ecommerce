// Port to code not moved into modules yet (pre-order arrivals; moves with the pre-order campaign module).
import type { IPreorderApi } from '../preorder-campaign/index.ts'
import type { IStockLedger } from '../stock/index.ts'

/** What receipts need: the stock ledger and pre-order arrival allocation (ADR 0013). */
export type StockReceiptPorts = {
  stock: IStockLedger
  arrivals: { plan: IPreorderApi['planArrivals']; apply: IPreorderApi['applyArrivals'] }
}
