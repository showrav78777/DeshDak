# Customer wishlist increment

## Business outcome

Customers can now save approved products and return to them from a persistent, account-specific wishlist on the web application. The same exact APIs are documented for the future Flutter application.

## Delivered workflow

- Public visitors can continue browsing products without signing in.
- Choosing **Save to wishlist** requests customer sign-in only when the account-specific action is performed.
- Signed-in customers can save and unsave a product from its product-detail page.
- `/wishlist` lists current saved products, current price/availability, seller/store context, and one available option.
- Customers can move an available option into their cart or remove it from the wishlist.
- Repeated save and removal requests are idempotent.
- A customer can never read or remove another customer’s wishlist records.
- Inactive, restricted, deleted, category-disabled, or suspended-seller products are excluded from wishlist results and cannot be newly saved.
- A previously saved hidden product can still be removed by its owner without revealing its product details.
- Save and removal changes are recorded in the audit trail.

## Storage and API

Migration `20260830170000_customer_wishlist` adds `WishlistItem` with a unique customer/product pair and indexed customer chronology.

Exact private API contracts:

- `GET /api/v1/wishlist`
- `POST /api/v1/wishlist/items`
- `DELETE /api/v1/wishlist/items/{productId}`

The list supports bounded pagination and returns minimized product cards rather than database records. Internal customer IDs, seller-profile IDs, compliance evidence, and deleted fields are not exposed.

## Verification

`npm run test:wishlist` proves authentication, customer-role enforcement, trusted browser origin, unavailable-product rejection, idempotent save/removal, pagination, response privacy, ownership isolation, suspended-seller hiding, and removal of a retained hidden item.

The release gate also includes migration verification, OpenAPI drift verification, ESLint, TypeScript, and the optimized production build.
