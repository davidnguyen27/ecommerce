// The order module's public surface (ADR 0018): the module, its interfaces, and the helpers other code uses.
// Leaf files first, the module last: ES modules evaluate re-exports in this order, and the module's wiring imports
// modules (pre-orders) that import these helpers back, so they must be initialized before that cycle runs.
export {
  DEPOSITED_PREORDER,
  ORDER_VIEW_INCLUDE,
  orderLookupUrl,
  orderNotFound,
  parseOrderCode,
  paymentResultUrl,
  remainingOf,
  type OrderForView,
} from './order.constant.ts'
export { OrderLineImage, preorderOf, toPublicOrder, toPublicRefunds } from './order.mapper.ts'
export { issueOrderLookupUrl, recordOrderEvent } from './order.repository.ts'
export { assertCancellable } from './order.service.ts'
export type {
  CancelOutcome,
  Cancellation,
  IOrderQuery,
  IOrderService,
  OrderEventActor,
  OrderEventKind,
} from './order.interface.ts'
export { OrderModule, createOrderService, expireOverdueOrders } from './order.module.ts'
