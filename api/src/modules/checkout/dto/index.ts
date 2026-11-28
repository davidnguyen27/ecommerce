// Request schemas come from @ecommerce/shared, so web and API share one contract (ADR 0018).
export {
  CheckoutQuoteRequest as CheckoutQuoteDto,
  CheckoutRequest as CheckoutDto,
  PreorderQuoteRequest as PreorderQuoteDto,
  PreorderRequest as PreorderDto,
} from '@ecommerce/shared'
