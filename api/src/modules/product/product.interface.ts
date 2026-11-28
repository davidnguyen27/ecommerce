import type { ProductCard, ProductSort, PublicProduct } from '@ecommerce/shared'
import type { DbClient } from '../../core/db.ts'
// Ports to code not moved into modules yet: typed by the current functions, wired in product.module.ts.
import type { IPreorderApi } from '../preorder-campaign/index.ts'
import type { IStockLedger } from '../stock/index.ts'
import type { ProductSnapshot } from './product.model.ts'
import type { SearchCriteria } from './product-search.repository.ts'

/** Who edits a variant and what they may change; built by the controller from the staff session. */
export type VariantActor = { staffId: string; canEditCatalog: boolean; canEditPrice: boolean }

/**
 * A cart line's variant as the customer sees it. `snapshot` is the product's live version (`null` when unpublished);
 * `variant` is that snapshot's variant, `null` when it can no longer be bought.
 */
export type CartVariant = { snapshot: ProductSnapshot | null; variant: ProductSnapshot['variants'][number] | null }

/** What the product module needs from stock and pre-orders. */
export type ProductPorts = {
  stock: Pick<IStockLedger, 'inStockIds'>
  preorders: { offers: IPreorderApi['preorderOffers'] }
}

/** Customer-facing product reads other code uses (chatbot, checkout, pre-orders, support). */
export interface IProductQuery {
  cartVariants(db: DbClient, variantIds: readonly string[]): Promise<Map<string, CartVariant>>
  searchProductCards(
    criteria: SearchCriteria,
    sort: ProductSort | undefined,
    page: number,
    pageSize?: number,
  ): Promise<{ items: ProductCard[]; total: number }>
  findPublicProduct(slug: string): Promise<PublicProduct | null>
}
