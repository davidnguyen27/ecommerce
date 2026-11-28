import type { AppDeps } from '../app.ts'
import type { BaseModule } from '../core/module/base.module.ts'
import { AttributeSchemaModule } from './attribute-schema/index.ts'
import { AuditLogModule } from './audit-log/index.ts'
import { AuthModule } from './auth/index.ts'
import { BrandModule } from './brand/index.ts'
import { CategoryModule } from './category/index.ts'
import { CheckoutModule } from './checkout/index.ts'
import { CommitmentTypeModule } from './commitment-type/index.ts'
import { CustomerModule } from './customer/index.ts'
import { CustomerAuthModule } from './customer-auth/index.ts'
import { OrderModule } from './order/index.ts'
import { PaymentModule } from './payment/index.ts'
import { PreorderCampaignModule } from './preorder-campaign/index.ts'
import { ProductModule } from './product/index.ts'
import { ProductImportModule } from './product-import/index.ts'
import { ReconciliationModule } from './reconciliation/index.ts'
import { RefundModule } from './refund/index.ts'
import { ReturnWindowModule } from './return-window/index.ts'
import { ShippingFeeModule } from './shipping-fee/index.ts'
import { StaffModule } from './staff/index.ts'
import { StockModule } from './stock/index.ts'
import { StockReceiptModule } from './stock-receipt/index.ts'
import { SupportModule } from './support/index.ts'
import { VoucherModule } from './voucher/index.ts'

/**
 * Builds every module in dependency order: a module that needs another's query interface is built after it and gets
 * it in its constructor. Routes mount in this order.
 */
export function createModules(deps: AppDeps): BaseModule[] {
  const schemas = new AttributeSchemaModule(deps)
  const categories = new CategoryModule(deps)
  const stock = new StockModule(deps)
  const orders = new OrderModule(deps)
  const customerAuth = new CustomerAuthModule(deps)
  return [
    schemas,
    categories,
    new BrandModule(deps),
    new CommitmentTypeModule(deps),
    new ProductModule(deps, { schemas: schemas.query, categories: categories.query }),
    new ProductImportModule(deps, stock.ledger),
    // Before `stock`: receipts have their own permission, the stock router guards everything under it.
    new StockReceiptModule(deps, stock.ledger),
    stock,
    orders,
    new PreorderCampaignModule(deps, orders.service),
    new CheckoutModule(deps, stock.ledger),
    new PaymentModule(deps, orders.service),
    new RefundModule(deps, orders.query),
    new ReconciliationModule(deps, orders.query),
    new VoucherModule(deps),
    new ShippingFeeModule(deps),
    new ReturnWindowModule(deps),
    new SupportModule(deps, orders.query),
    new AuthModule(deps),
    new StaffModule(deps),
    new AuditLogModule(deps),
    customerAuth,
    // After the other `/account/…` routes; its customer sign-in check runs for every path under `/account`.
    new CustomerModule(deps, customerAuth.sessions),
  ]
}
