# Feed Fusion Tanzania — MVP Spec (Sales, Inventory & Business Control System)

> Source: original MVP definition, kept verbatim for reference. See `mvp-addendum.md` for the price-approval and discount extensions layered on top of this.

A business buys products from suppliers → receives them into stock → customers come physically to the office/shop → one or more sales users serve customers simultaneously → customer chooses products → pays immediately → goods are released → every sale is recorded → invoice/receipt can be printed → stock updates automatically → owner sees sales, stock, cash, profit, discrepancies, and overall business performance.

## 1. MVP Product Definition

**Working concept:** Sales, Inventory & Business Control System

The MVP has one main objective: control what comes into the business, what is sold, what cash should exist, what remains in stock, and how the business is performing. It is not trying to become a huge ERP.

Core loop:
```
SUPPLIER → PURCHASE/STOCK IN → AVAILABLE STOCK → CUSTOMER → SALE →
CASH PAYMENT → INVOICE/RECEIPT → STOCK REDUCED → CASH EXPECTED UPDATED →
PROFIT UPDATED → OWNER DASHBOARD/REPORTS
```

## 2. Actors

**Owner/Admin** — sees dashboard, all sales, all stock; adds products/categories; records purchases; manages users; sees reports/profit/expected cash; performs stock counts; investigates discrepancies; approves sensitive actions; views audit history.

**Sales User** — logs in, sees/searches available products, creates a sale, changes quantity, completes a cash sale, prints receipt, views own sales. Cannot: delete completed sales, freely change cost/price, manually edit stock, delete transactions.

**Optional Manager Role** — can approve void sale / stock adjustment / price changes. Not required for MVP; owner + sales is sufficient initially.

## 3. Modules

1. Authentication & Users
2. Dashboard
3. Categories
4. Products
5. Suppliers
6. Purchases / Stock In
7. Inventory
8. Sales / POS
9. Invoice & Receipt
10. Cash Control
11. Stock Count & Adjustment
12. Expenses
13. Reports
14. Audit Trail
15. Alerts

## 4. Authentication & Users

Every user has their own account: username/email, password, role, status. Every important transaction records who created it, plus date/time.

## 5. Business Setup

Business name, phone, email, address, TIN, currency — shown on invoices/receipts.

## 6. Categories

Flexible category tree, e.g. Fish Feed / Poultry Feed / Other, extendable by the owner.

## 7. Products

Fields: Product ID, Name, Category, Unit, Default Selling Price, Minimum Stock Level, Active/Inactive, Created At. **Important:** the product does not store current stock as manually editable data — stock comes from movements.

## 8. Suppliers

Name, phone, email (optional), address (optional), notes, status. Owner can see purchases made, products supplied, total purchased, purchase history per supplier.

## 9. Purchase / Stock In

A purchase record: supplier, date, reference number, products, quantity, unit cost, total cost, additional costs, notes, created by. Creates a stock movement (e.g. `KPC-30: BEFORE 20, PURCHASE +100, AFTER 120`).

## 10. Cost Calculation

Additional costs (e.g. transport) are allocated into stock cost so profit calculations don't lie. Example: product cost 4,200,000 + transport 50,000 = total inventory cost 4,250,000 → actual cost per bag 42,500.

## 11. Inventory

Shows current quantity, stock value (cost and selling), status (Healthy/Low/Out of Stock), and full stock movement history per product so the owner can answer "where did the stock go?"

## 12. Core Rule — Stock Movement

Stock must never change without a movement record. `Current Stock = All Stock In − All Stock Out`. This is the single most important MVP rule.

## 13. Sales / POS

Flow: open sale → search product → add product → enter quantity → system checks stock → add more products → customer pays → confirm sale → sale completed → print (optional).

## 14. Cash Sale Rule

No credit, no customer debt in MVP. Every completed sale is immediately `PAID`.

## 15. Sale Completion

On "Complete Sale," the system must, as one atomic database transaction: validate stock, create sale, create sale items, record payment, deduct stock, record stock movements, calculate COGS, calculate gross profit, update cash expected, generate invoice number, create audit record. Either the whole sale succeeds or none of it does.

## 16. Multiple Users Selling Simultaneously

The system must prevent overselling under concurrent sales. Final stock validation happens at commit time, not just when items are added to a cart.

## 17. Insufficient Stock

If requested quantity exceeds available stock, the sale cannot complete for that quantity; the user can reduce quantity, remove the product, or cancel.

## 18. Invoice / Receipt

Every completed sale gets a unique invoice number. Contains business details, invoice number, date/time, products, quantities, unit price, total, payment status, served-by. Recording is mandatory; printing is optional.

## 19. Printing Scenarios

After sale completion, user can print/reprint/close. Owner can search and reprint later, including after printer failure — the sale is never repeated to "fix" a failed print.

## 20. Cash Control

Because payment is always immediate, expected cash = sum of the day's sales. At closing, actual cash is counted and compared; a discrepancy is recorded with notes, not automatically treated as theft.

## 21. Cash Count Scenario

System prompts for actual cash counted, calculates the difference, requires reason/notes, and stores a historical record (date, expected, actual, difference, counted by, notes).

## 22. Stock Count

Owner starts a stock count; system compares expected vs. physical count, records the difference, requires a reason (Damaged/Missing/Counting correction/Other), and creates a permanent adjustment movement if approved — never a silent quantity edit.

## 23. Stock Adjustment Rule

Manual stock changes are never allowed directly. Adjustments are their own record: product, quantity, reason, notes, created by, approved by. Owner approval is mandatory for MVP.

## 24. Expenses

Category, amount, description, date, created by. Distinguish costs that belong to inventory (e.g. transport for new stock, allocated into cost) from general operating expenses (e.g. electricity) which must not inflate product cost.

## 25. Dashboard

Today's sales, transactions, gross profit, expenses, estimated net, expected cash, low-stock alerts, discrepancy alerts, cash-not-counted alerts, top-selling products.

## 26. Reports

Sales report (by date range), product sales report (quantity, revenue, cost, gross profit), stock report, low-stock report, user sales report (as a management signal, not an accusation), cash report (expected vs actual, historical).

## 27. Audit Trail

Records important actions with timestamp, user, and action detail, to answer "what happened?"

## 28. Business Rules (BR-01 to BR-25)

- BR-01: Only authenticated users can access the system.
- BR-02: Every user has their own account.
- BR-03: Every completed sale must have at least one product.
- BR-04: Every completed sale is immediately marked PAID.
- BR-05: A sale cannot complete without sufficient stock.
- BR-06: Stock cannot become negative.
- BR-07: Every completed sale automatically reduces stock.
- BR-08: Every completed sale automatically records a stock movement.
- BR-09: Every completed sale gets a unique transaction/invoice number.
- BR-10: Printing is optional; recording the sale is mandatory.
- BR-11: Completed sales cannot simply be deleted.
- BR-12: A cancellation/void must preserve the transaction history.
- BR-13: Only authorized users can void a completed sale.
- BR-14: Every purchase automatically increases stock.
- BR-15: Every stock change must have a source or reason.
- BR-16: Manual stock editing is not allowed.
- BR-17: Stock adjustments require a reason.
- BR-18: The system must support simultaneous sales safely.
- BR-19: The system must prevent overselling during simultaneous transactions.
- BR-20: Every completed sale records the responsible user.
- BR-21: Cash reconciliation compares expected cash with physically counted cash.
- BR-22: A discrepancy must be recorded, not hidden.
- BR-23: Product selling prices should be controlled by authorized users.
- BR-24: Product cost must not be exposed unnecessarily to sales users.
- BR-25: Owner can see the complete history of important transactions.

(See `mvp-addendum.md` for BR-26 through BR-34, added for price approval and discounts.)

## 29. MVP Success Criteria

The owner must be able to reliably answer: what stock do I have, what did I sell today, how much cash should exist, which products generated profit, who made this sale, why did stock decrease, does physical stock/cash match the system, and is the business improving or declining.

## 30. Explicitly Out of Scope for MVP

Customer credit, debtor management, loyalty programs, multi-branch, multiple warehouses, full accounting, payroll, forecasting/AI, native mobile app, complex supplier debt, complex tax integrations, barcode hardware integration.
