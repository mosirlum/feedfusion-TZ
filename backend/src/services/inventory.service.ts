import * as inventoryRepo from '../db/inventoryRepo';
import * as stockMovementsRepo from '../db/stockMovementsRepo';
import { HttpError } from '../middleware/errorHandler';
import * as productsRepo from '../db/productsRepo';

export type StockStatus = 'HEALTHY' | 'LOW' | 'OUT_OF_STOCK';

function stockStatus(currentStock: number, minimumStock: number): StockStatus {
  if (currentStock <= 0) return 'OUT_OF_STOCK';
  if (currentStock <= minimumStock) return 'LOW';
  return 'HEALTHY';
}

export async function getInventory() {
  const rows = await inventoryRepo.getInventorySummary();
  return rows.map((row) => {
    const lastUnitCost = row.last_unit_cost !== null ? Number(row.last_unit_cost) : null;
    return {
      ...row,
      status: stockStatus(row.current_stock, row.minimum_stock),
      stock_value_cost: lastUnitCost !== null ? lastUnitCost * row.current_stock : null,
      stock_value_selling: row.active_price !== null ? Number(row.active_price) * row.current_stock : null,
    };
  });
}

export async function getLowStock() {
  const inventory = await getInventory();
  return inventory.filter((row) => row.status === 'LOW' || row.status === 'OUT_OF_STOCK');
}

export async function getStockHistory(productId: number) {
  const product = await productsRepo.findProductById(productId);
  if (!product) {
    throw new HttpError(404, 'PRODUCT_NOT_FOUND');
  }
  const movements = await stockMovementsRepo.listMovementsForProduct(productId);
  return { product, movements };
}
