// Port to code not moved into modules yet (pre-order arrivals; moves with the pre-order campaign module).
import type { applyArrivals, planArrivals } from '../../preorders/arrivals.ts'
import type { IStockLedger } from '../stock/index.ts'

/** What receipts need: the stock ledger and pre-order arrival allocation (ADR 0013). */
export type StockReceiptPorts = {
  stock: IStockLedger
  arrivals: { plan: typeof planArrivals; apply: typeof applyArrivals }
}
