// The order module's public surface (ADR 0018): the module, its interfaces, and the helpers other code uses.
export { OrderModule, createOrderQuery, createOrderService, expireOverdueOrders } from './order.module.ts'
export type {
  CancelOutcome,
  Cancellation,
  IOrderQuery,
  IOrderService,
  OrderEventActor,
  OrderEventKind,
} from './order.interface.ts'
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
